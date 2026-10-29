# 十、ECS 与 DOTS

> 适用 Unity Entities 1.x。标题即面试问题，正文先给结论、再上要点。

## 10.1 什么是 ECS？

Unity 的 ECS，全称 Entity Component System，即"实体—组件—系统"，是一种面向数据的架构，也是 DOTS 技术栈的核心。它通过分离数据与逻辑、优化内存布局，提升大量实体的处理效率。

三个概念：

- **Entity（实体）**：唯一标识，不承载数据和逻辑。一个敌人、一颗子弹都是一个实体；代码里是轻量句柄，只有索引和版本号。
- **Component（组件）**：只存数据，通常是实现 `IComponentData` 的结构体，如位置、速度、血量。
- **System（系统）**：只写逻辑，筛选拥有特定组件组合的实体并批量处理。移动系统处理所有带位置和速度的实体。

一次完整流程：刷怪创建实体 → 挂 `LocalTransform`、`MoveSpeed`、`Health` → 移动系统每帧遍历更新位置 → 血量归零后清理系统销毁实体。没有任何对象"自己会动"。

与 GameObject 最本质的区别：敌人不是对象，而是一条记录；数据按类型集中存放，系统顺序遍历。所以 ECS 优化的是内存访问，不是代码行数。

思想来源是 DOD：先设计数据长什么样、怎么被访问，再决定逻辑。回答顺序：DOD 是思想，ECS 是模式，Entities 是实现，DOTS 是技术栈。

## 10.2 和传统的 GameObject 开发有什么区别？

GameObject 本身也是组件模式，差别不在"拆组件"，而在这三点：

| 维度 | GameObject | ECS |
| --- | --- | --- |
| 身份 | 堆上对象引用 | 8 字节句柄 |
| 数据 | 跟着对象走，内存分散 | 按类型连续存放 |
| 逻辑 | 组件自己的方法 | 统一由 System 批量处理 |

- 扩展：继承 + 组合 vs 组件组合。
- 性能：OOP 遍历是随机内存访问，ECS 是顺序扫描，数据量大时差距明显。
- 并行：Chunk 天然可切给 Job。

## 10.3 ECS、Entities、DOTS 是什么关系？

三个层次：ECS 是架构模式；Entities 是 Unity 的实现（`com.unity.entities`）；DOTS 是完整技术栈。

```text
DOD：设计思想
  └── DOTS：Unity 数据导向技术栈
      ├── Entities：实现 ECS
      ├── Job System：多线程调度
      ├── Burst：原生代码优化
      ├── Collections：非托管容器
      ├── Mathematics：SIMD 数学库
      ├── Entities Graphics：实体渲染
      ├── Unity Physics：数据导向物理
      └── Netcode for Entities：ECS 网络方案
```

DOTS ≠ ECS：Job、Burst、Collections 可以单独用在 MonoBehaviour 项目里。

## 10.4 Entity 为什么设计成句柄？

Entity = Index + Version，两个 int。

```csharp
public struct Entity
{
    public int Index;    // 定位：第几个实体槽位
    public int Version;  // 校验：槽位被复用了几次
}
```

- Index：可直接当数组下标，快速定位在 Chunk 中的位置。
- Version：实体销毁后 Index 会被复用，版本不匹配即判定失效，避免悬垂引用。
- 不用对象引用：托管对象、GC 压力、内存分散，且无法直接算偏移。

## 10.5 Component 怎么写、怎么拆？

只存数据，用非托管 struct：能连续存储、无 GC、可 Burst、可并行 Job。

```csharp
public struct Health : IComponentData
{
    public int Current;
    public int Max;
}

public struct MoveSpeed : IComponentData
{
    public float Value;
}
```

拆分原则：

- 一起读、一起写、同频率变化的字段放同一组件（按访问模式拆，冷热分离）。
- 不要一个大组件：Chunk 装的实体变少，缓存利用率下降。
- 不要拆到字段级：Archetype 组合爆炸，结构变化变多。
- 不写业务方法：逻辑属于 System。

例：位置用 `LocalTransform`；血量、移速分开；背包用 Dynamic Buffer；模型引用放托管组件或只存索引。

## 10.6 System 怎么跑起来的？

每次被调度，做三步：找到数据 → 批量处理 → 写回。

```csharp
[BurstCompile]
public partial struct MoveSystem : ISystem
{
    [BurstCompile]
    public void OnUpdate(ref SystemState state)
    {
        float dt = SystemAPI.Time.DeltaTime;
        foreach (var (transform, speed) in
                 SystemAPI.Query<RefRW<LocalTransform>, RefRO<MoveSpeed>>())
        {
            transform.ValueRW.Position += speed.ValueRO.Value * dt
                                        * transform.ValueRO.Forward();
        }
    }
}
```

OOP 是"数据调用方法"，ECS 是"方法遍历数据"。

运行时由 World 持有：实体数据、EntityManager、System 与分组、Query 和时间。Default / Client / Server World 互相隔离，句柄不能跨 World；Baking World 只在编辑器阶段存在。

EntityManager 负责增删实体和组件、读写、实例化 Prefab、建 Query，其中增删类操作都是结构变化。

## 10.7 数据存在哪里？

Archetype：组件类型集合完全相同的实体。只看类型组合、不看值，相当于签名。

Chunk：固定 16 KiB 的连续内存块，存同一 Archetype 的实体。一个 Archetype 对应多个 Chunk，一个 Chunk 只属于一个 Archetype。

```text
Archetype "LocalTransform + MoveSpeed"
├── Chunk 0 (16 KiB)
│   ├─ Entity[]          : [E17][E23][E42] ...
│   ├─ LocalTransform[]  : [ ][ ][ ] ...   ← 同类型连续
│   └─ MoveSpeed[]       : [ ][ ][ ] ...
└── Chunk 1 (16 KiB)
```

- 容量：`(16384 − 头部) / (sizeof(Entity) + Σ sizeof(组件))`，44 字节/实体时约 370 个。
- 删除是 swap-back：末尾实体补位，遍历顺序不稳定。
- 按组件分列（粗粒度 SoA），组件内部字段仍连续（AoS）；不拆到字段级，否则 Archetype 爆炸。

## 10.8 ECS 为什么快？

1. 缓存：同类组件连续，64 字节缓存行顺序用满；OOP 随机访问，主存比缓存慢两个数量级。
2. 批量：紧凑循环，无虚调用、无属性访问。
3. 无指针追逐：实体直接定位数组偏移。
4. 低 GC：非托管数据。
5. 并行：Chunk 是天然工作单元。
6. Burst + SIMD：一条指令处理多个数据。

反面：结构变化频繁、随机访问多、组件设计差、Job 过细、频繁 Complete，都会让它比 MonoBehaviour 还慢。

## 10.9 为什么加一个组件会很慢？

因为 Archetype 变了，实体要搬到新 Chunk，所有组件重新复制。

成本：

- memcpy 到新 Chunk 空槽；
- Chunk 满则新分配，源 Chunk 用末尾元素补位；
- 数据被 Job 读写时要等 Job 完成（同步点）；
- 主线程串行执行。

算结构变化：创建/销毁实体、增删组件、修改 Shared Component 值。
不算：改组件值、开关 Enableable、改 Buffer 内容、换 Blob 引用。

优化：

- 用 Enableable 代替增删，只翻启用位，数据不动；
- 用 ECB 集中回放；
- 预创建 + Disabled 做对象池；
- 分帧摊平峰值。

ECB 只延迟和集中，不消除成本。

## 10.10 Component 有哪几种？

| 类型 | 用途 | 注意事项 |
| --- | --- | --- |
| `IComponentData` | 普通数据 | 用非托管 struct |
| Tag | 无字段标记 | 增删仍是结构变化 |
| `IEnableableComponent` | 高频开关 | 不用 Add/Remove |
| `IBufferElementData` | 变长数据 | 背包、路径、关系 |
| Shared Component | 共享分组 | 值多会切碎 Chunk |
| Managed Component | 托管桥接 | 不能 Burst、不能并行 Job |
| Blob Asset | 只读共享 | 配置表、曲线 |

- Enableable：被禁用的组件默认不匹配 Query，但数据留在原地。
- Dynamic Buffer：Chunk 内放得下就内联，否则堆分配。
- Shared Component：同值实体归到同一批 Chunk，改值算结构变化。
- Blob：不可变、带引用计数、可任意并行读。

## 10.11 Query 怎么找到数据？

匹配粒度是 Archetype，不是实体：先匹配签名，再遍历 Chunk。结果会缓存，Archetype 变化时增量更新。

条件：All / Any / None、启用状态、Shared Component 值、Change Filter（按版本号跳过未修改的 Chunk）。

```csharp
var query = SystemAPI.QueryBuilder()
    .WithAll<LocalTransform, MoveSpeed>()
    .WithNone<Stunned>()
    .Build();
```

访问方式：

- `SystemAPI.Query`：主线程遍历；
- `IJobEntity`：并行批处理，最常用；
- `IJobChunk`：需要精确控制 Chunk；
- `ComponentLookup` / `BufferLookup`：按实体随机访问。

随机访问等于放弃缓存优势，能用 Query 顺序拿就别查。

## 10.12 System 怎么写？

| 类型 | 实现 | 特点 |
| --- | --- | --- |
| `ISystem` | struct | 非托管，可 Burst |
| `SystemBase` | class | 可持托管引用，用于桥接 |

```csharp
[BurstCompile]
public partial struct MoveSystem : ISystem
{
    public void OnCreate(ref SystemState state)
    {
        state.RequireForUpdate<MoveSpeed>();
    }

    [BurstCompile]
    public void OnUpdate(ref SystemState state) { }
}
```

生命周期：OnCreate（建 Query）→ OnStartRunning / OnStopRunning（匹配数据有无切换）→ OnUpdate → OnDestroy。

ISystem 用 struct 的原因：Burst 要求无托管状态，字段只能是 `NativeArray`、基本类型、Blob 引用。要拿 MonoBehaviour 得靠 SystemBase 桥接。

## 10.13 多个 System 谁先谁后？

顶层顺序：Initialization → Simulation → Presentation。

Simulation 内分 FixedStep（一帧 0..N 次，物理、确定性逻辑）和 VariableRate（每帧一次）。

```csharp
[UpdateInGroup(typeof(SimulationSystemGroup))]
[UpdateAfter(typeof(InputSystem))]
[UpdateBefore(typeof(CombatSystem))]
public partial struct MoveSystem : ISystem { }
```

还有 `[DisableAutoCreation]`；`RequireForUpdate<T>()` 可在无数据时跳过更新。

顺序 ≠ 完成：OnUpdate 常常只调度 Job，完成时间由 `JobHandle`、`state.Dependency` 和读写依赖决定，要同步必须显式 Complete。

## 10.14 怎么用满多核？

靠 Job System。ECS 不会自动并行。

类型：IJob、IJobParallelFor、IJobParallelForDefer、IJobEntity（最常用）、IJobChunk。

```csharp
[BurstCompile]
public partial struct MoveJob : IJobEntity
{
    public float DeltaTime;
    void Execute(ref LocalTransform t, in MoveSpeed s)
        => t.Position += s.Value * DeltaTime * t.Forward();
}

var job = new MoveJob { DeltaTime = SystemAPI.Time.DeltaTime };
state.Dependency = job.ScheduleParallel(state.Dependency);
```

依赖：只读 + 只读可并行；只要有一方写，就必须串起来。

原则：尽早调度、尽晚 Complete；频繁 Complete 会吃掉全部并行收益。

粒度：工作量太小不值得拆，调度开销会超过收益。

## 10.15 Burst 是什么？

把受约束的 C# 编译成原生机器码：AOT、SIMD、循环优化、常量折叠。

Job 负责并行，Burst 负责单条代码更快；两者独立，Burst 也能用于普通静态方法。

限制：无托管对象、无 `string`、无托管容器、无 `try/catch`；日志用 `FixedString` 或 `[BurstDiscard]`。

它不解决随机内存访问、同步点和主线程瓶颈；浮点优化会影响确定性。

## 10.16 为什么 Job 里不能用 List<T>？

托管容器有 GC、有引用、非线程安全，工作线程不能安全访问托管堆。

能用：`NativeArray`、`NativeList`、`NativeHashMap`、`NativeParallelHashMap`、`NativeParallelMultiHashMap`、`NativeQueue`、`NativeStream`、`NativeReference`。

Allocator：`Temp`（仅主线程，不能进 Job）、`TempJob`（跨 Job 短期）、`Persistent`（长期）。

坑：必须 Dispose；Job 未完成不能释放；别高频建大容器；别超过分配器生命周期。

## 10.17 怎么在 Job 里改结构？

用 ECB：Job 里只记录命令，安全时机统一回放。

原因：遍历中改结构会破坏迭代；Job 不能碰 `EntityManager`。

```csharp
var ecb = SystemAPI
    .GetSingleton<EndSimulationEntityCommandBufferSystem.Singleton>()
    .CreateCommandBuffer(state.WorldUnmanaged)
    .AsParallelWriter();

ecb.DestroyEntity(0, entity);   // 0 是 sortKey
```

- 延迟实体：回放前只是句柄，可继续 AddComponent，但不能用 EntityManager 读。
- 并行要 `ParallelWriter` + `sortKey`（`entityInQueryIndex` / `chunkIndex`）保证顺序确定。
- 回放时机由内置系统决定：EndSimulation 最常用，BeginSimulation 帧初，BeginPresentation 表现前。
- 回放本身是集中结构变化，仍可能等 Job。

## 10.18 编辑器数据怎么变成实体？

Authoring（MonoBehaviour 配数据）→ Baker（转成组件）→ Entity Scene / SubScene → 运行时 World。

```csharp
public class SpawnerBaker : Baker<SpawnerAuthoring>
{
    public override void Bake(SpawnerAuthoring authoring)
    {
        var entity = GetEntity(TransformUsageFlags.None);
        AddComponent(entity, new Spawner
        {
            Prefab = GetEntity(authoring.Prefab, TransformUsageFlags.Dynamic),
            Interval = authoring.Interval,
        });
    }
}
```

为什么要烘焙：编辑器数据灵活但运行时贵；烘焙成紧凑二进制，增量执行，运行时只做加载。

`TransformUsageFlags`：告诉烘焙器要不要 Transform 数据（`Dynamic` / `None`），直接决定组件数量。

1.x 用 Baking，旧版 `Convert To Entity` 已过时；ECS 可与 GameObject 混合。

## 10.19 怎么优化？

优先级：

1. 少结构变化（Enableable、ECB、预创建、分帧）。
2. 少同步点和 `Complete()`。
3. 组件按访问模式拆。
4. Query 顺序访问，少用 `ComponentLookup`。
5. 大规模计算上 Job + Burst。

避免：Archetype 失控、Shared 值过多、大规模随机访问、滥用托管组件、每帧分配容器、组件过大或过细、小任务滥用 Job。

排查顺序：同步点 → 缓存 → 并行度 → 算法。

## 10.20 什么项目适合 ECS？

标准：数据量大、结构同构、可批量并行。

- 适合：大量单位/子弹、群集与交通模拟、大规模空间查询。
- 不适合：UI、少量复杂对象、强依赖 MonoBehaviour 插件、个体逻辑差异大、没有性能瓶颈的小功能。

混合架构：GameObject 管 UI、输入、相机、资源；ECS 管海量单位和计算热点。

## 10.21 常见误区

- DOTS 就是 ECS → ECS 只是核心之一。
- Entity 是整数 → 是 Index + Version 句柄。
- ECS 自动并行 → 要自己写 Job。
- 不同 Chunk 无竞争 → 看读写权限和依赖。
- ECB 消除结构变化成本 → 只延迟和集中。
- ISystem 是托管类 → 是 struct。
- 组件必须非托管 → 有托管组件，但性能受限。
- 组件越细越好 → 会 Archetype 爆炸。
- ECS 一定快 → 看规模和数据布局。
- Chunk 大小可调 → 固定 16 KiB。

---

# 扩展知识点（选读）

## 扩展一：一帧里 ECS 做了什么

```text
编辑器：Authoring → Baker → Entity Scene（SubScene 产物）
运行时：Entity Scene → World（按 Archetype 重建 Chunk）

每帧：
InitializationSystemGroup      输入、时间、单例
SimulationSystemGroup
  ├─ FixedStep（0..N 次）       物理、确定性逻辑
  └─ VariableRate
       ├─ OnUpdate：Query 匹配 → 遍历 Chunk
       ├─ Schedule(IJobEntity) → state.Dependency
       └─ EndSimulationECB.Playback   ← 集中同步点
PresentationSystemGroup        LocalToWorld 更新、提交渲染
```

讲法：数据在哪（World / Archetype / Chunk）→ 时间顺序（三个分组）→ 两个同步点（ECB 回放、显式 Complete）。

## 扩展二：常用工程写法

- **单例组件**：`GetSingleton` / `SetSingleton` / `TryGetSingleton`，用于跨系统共享数据。
- **事件队列**：单例实体挂 Dynamic Buffer，帧内写入、帧末清空；非托管、可并行写。
- **对象池**：预创建 + `Disabled`（Enableable），用时启用、归还禁用，不产生结构变化。
- **桥接**：ECS → UI 用 `SystemBase` 读数据写回；UI → ECS 写单例或 ECB。桥接点要少、要批量。

## 扩展三：术语、工具与版本

| 术语 | 含义 |
| --- | --- |
| Archetype | 组件类型组合的签名 |
| Chunk | 16 KiB 连续内存块 |
| Structural Change | 改变实体存储结构的操作 |
| Sync Point | 必须等待 Job 完成的点 |
| ECB | 延迟执行结构变化的命令缓冲 |
| Baking | 编辑器数据 → 运行时实体数据 |

- 工具：Entities Hierarchy（实体与 Chunk）、Systems 窗口（顺序）、Profiler Entities 模块（结构变化、耗时）、Entities Journaling（改数据的来源）、Burst Inspector（汇编、SIMD）。
- 版本：0.x 的 `GameObjectConversion`、`ComponentSystem`、`Entities.ForEach`、`ComponentDataFromEntity`，在 1.x 换成 `Baker`、`ISystem`、`SystemAPI.Query`、`ComponentLookup`；Transform 统一为 `LocalTransform` + `LocalToWorld`。

## 扩展四：一分钟速记

```text
DOD 是思想，ECS 是模式，Entities 是实现，DOTS 是栈。
Entity 是句柄，Component 存数据，System 批处理。
Archetype 分类，Chunk 连续存储（16 KiB），Query 匹配。
Job 并行，Burst 编译，Collections 管内存，ECB 延迟改结构，Baking 转数据。
优化：少结构变化、少同步、少随机访问。
```
