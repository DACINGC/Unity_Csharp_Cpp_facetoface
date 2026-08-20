# 六、Unity 引擎

## 6.1 生命周期与脚本

### 6.1.1 生命周期函数执行顺序

```
Awake → OnEnable → Start → Update → FixedUpdate → LateUpdate → OnGUI
     → OnDisable → OnDestroy
```

（编辑器下还有 Reset，在 Awake 之前；脚本每次进入 Play 模式时执行。）

| 函数 | 触发时机与用途 |
| --- | --- |
| Awake | 对象实例化时执行一次（用于初始化）；即使脚本未启用也会调用 |
| OnEnable | 每次对象/脚本启用时调用；同一生命周期中**可反复发生** |
| Start | 第一次 Update 前调用一次（用于获取初始值、启动协程） |
| Update | 每帧调用（与帧率相关），适合逻辑控制 |
| FixedUpdate | 固定时间步长调用，适合物理计算 |
| LateUpdate | 所有 Update 之后调用，适合相机跟随等 |
| OnGUI | 每帧绘制 GUI（效率低） |
| OnDisable | 对象/脚本失活时调用 |
| OnDestroy | 对象销毁时调用 |

- 顺序记忆：`Awake → OnEnable → Start`；其中 **OnEnable 可以在同一对象生命周期中反复发生**（每次 SetActive(true)）。
- **OnBecameVisible / OnBecameInvisible**：当物体"是否可见"状态切换时触发；用于只在物体可见时才进行的计算（如相机剔除）。

### 6.1.2 Unity 的本质与脚本

- Unity 的本质（常见面试说法）：场景和预制体本质都是**配置文件**，运行时解析配置创建对象；脚本类名必须与文件名一致（引擎按文件名/类型名查找 Type）。
- 更严谨的表述：Unity 底层是原生（C++）引擎，场景数据通过**序列化系统**加载，C# 侧通过脚本绑定（wrapper）与引擎对象互操作；"反射"是其中类型查找/绑定机制的简化说法。
- 支持语言：早期支持 C# / JavaScript / Boo，现**仅支持 C#**。
- 编辑器类（Editor 脚本）存放路径：工程目录下 `Assets/Editor` 文件夹（或 Editor 子目录）。
- 调试输出：`Debug.Log()` / `Debug.LogWarning()` / `Debug.LogError()`。
- 切换场景：`SceneManager.LoadScene("场景名")`（`Application.loadLevel` 已弃用）。
- 常用编辑器特性：`[ContextMenu]` 在组件右键菜单添加回调；`[MenuItem("菜单名")]` 添加顶部菜单栏（需静态方法）；`[ExecuteInEditMode]` 编辑模式下执行 Update；`[Header]`、`[SerializeField]` 等序列化特性。

### 6.1.3 Mono 与 IL2CPP 的区别

| 对比项 | Mono | IL2CPP |
| --- | --- | --- |
| 编译流程 | C# → IL（中间语言/CLR 字节码）→ 各平台 Mono 虚拟机解释/编译为机器码 | C# → IL → 转成 **C++ 代码** → 由各平台 C++ 编译器（AOT）编译为机器码 |
| 性能 | 相对较低（虚拟机运行时开销、GC 更频繁） | 更高（AOT 机器码，更接近原生性能，GC 更可控） |
| 包体/启动 | 需打包 Mono 运行时（跨平台库），包体大 | 不含运行时，包体更小、启动更快 |
| 反编译 | 可通过 **ILSpy** 等工具反编译 IL，易被破解 | 编译为原生机器码，**难以反编译**（安全性更好） |
| 兼容性 | 对 C# 特性（如 `System.Reflection.Emit` 动态生成代码）支持更好 | 不支持运行时动态生成 IL/反射 Emit（代码裁剪需处理） |
| 平台支持 | 平台有限 | 几乎全平台（iOS 等禁止 JIT 的平台必须用 IL2CPP） |

- **总结**：Mono 是 JIT/解释执行的运行时方案（C# → IL → 虚拟机执行），灵活、调试方便、支持运行时动态生成代码，但性能与包体吃亏；IL2CPP 把 IL 转成 C++ 再 AOT 编译为机器码，性能高、包体小、难破解、几乎全平台，代价是不支持动态代码生成、需处理代码裁剪。**正式发布与移动端默认选 IL2CPP（iOS 强制）**；开发调试期或依赖反射 Emit 等动态特性的项目选 Mono。
- 注：iOS 平台因禁止 JIT（运行时生成代码），只能使用 IL2CPP。

**为什么 Unity 游戏容易被逆向破解**：

- **托管语言 + 完整元数据**：C# 产物含完整类型/方法/字符串信息——Mono 下 IL 可直接反编译为源码（ILSpy/dnSpy）；IL2CPP 虽为原生码，但 `global-metadata.dat` 元数据仍明文存在，配合 Il2CppDumper 可还原结构，门槛远低于纯 C++。
- **逻辑与数值集中在客户端**：单机/弱联网游戏的判定、数值、配置（AssetBundle/JSON）都在客户端，逆向后可读可改。
- **资源明文打包**：模型、贴图、关卡数据可被 AssetStudio/UABE 直接解包提取。
- **校验薄弱**：多数游戏无完整性校验/反调试，Android 端可改包重签名，配合 Cheat Engine 可直接改内存值（血量、金币）。
- **生态工具链成熟**：dnSpy、Il2CppDumper、AssetStudio、Frida 等开源工具成熟，破解门槛低。

**应对思路**：IL2CPP + 代码混淆（字符串加密、控制流混淆）、资源加密、敏感逻辑上收服务器（服务端权威）、完整性校验与反调试。

## 6.2 物理系统

### 6.2.1 Rigidbody 与 CharacterController 的区别

- Rigidbody 具有**完全真实物理**的特性（重力、碰撞、受力响应）。
- CharacterController 是**受限的 Rigidbody**：具有一定物理效果但不是完全真实的（通常不受外力影响、不发生刚体碰撞，用于角色控制）。

### 6.2.2 碰撞器与触发器的区别

- 碰撞器（Collider）是触发器（Trigger）的载体；`Is Trigger` 是碰撞器上的一个属性。
- `Is Trigger = false`：碰撞器按物理引擎产生碰撞效果，回调 `OnCollisionEnter/Stay/Exit`。
- `Is Trigger = true`：碰撞器被物理引擎忽略，不产生碰撞效果，回调 `OnTriggerEnter/Stay/Exit`。
- 使用触发器的场景：只检测物体是否经过某个区域、不想让碰撞影响物体运动。

### 6.2.3 物体发生碰撞的必要条件

- 两个物体都必须带有 **Collider 碰撞器**，且其中一个还必须带有 **Rigidbody 刚体**（或 CharacterController）。
- 经典表述：物体 A 必须带有（Collider + Rigidbody）或 CharacterController，另一个物体至少带有 Collider。

### 6.2.4 碰撞的各个阶段（回调函数）

三个阶段：`OnCollisionEnter`（进入）、`OnCollisionStay`（持续接触）、`OnCollisionExit`（离开）。

### 6.2.5 射线检测原理

- 射线是 3D 世界中**一个点向一个方向发射的一条无终点的线**；发射轨迹中与其他物体发生碰撞时停止，返回碰撞信息。
- `Physics.Raycast`：从起点向方向发射物理射线，通过碰撞体形状计算交点，返回 `RaycastHit` 结构体（碰撞点、法线、碰撞体等）。
- 前提：被检测物体需要有 Collider。

### 6.2.6 施加力的方式

- `rigidbody.AddForce(...)`：施加力（力模式可指定）。
- `rigidbody.AddForceAtPosition(...)`：在指定位置施加力（可产生力矩）。
- 二者都是 Rigidbody 的成员函数。

### 6.2.7 链条关节（Hinge Joint）

- 模拟两个物体间用一根链条/铰链连接的情况：能保持两个物体在一个固定距离内相互移动而不产生作用力，**达到固定距离后产生拉力**（简单理解：像弹簧/铰链）。

### 6.2.8 高速小物体穿透及避免

**问题本质**：物理引擎是**离散步进**的——每个 FixedUpdate 检测一次碰撞。若物体两步之间移动的距离（速度 × 步长）大于碰撞体的厚度/尺寸，就会"跨过去"漏检，表现为穿透（tunneling）。**放大碰撞体、全局调小 FixedDeltaTime 会牺牲表现或开销剧增，实战不推荐**。

**实战方案（按优先级）**：

1. **高速子弹/投射物：不用物理碰撞，用射线/扫掠自判命中**——每帧从上一位置向新位置发射 `Physics.Raycast`/`SphereCast`，命中即停在碰撞点。表现完全可控、绝不穿透，是实战最常用做法。
2. **必须用刚体时定向开启 CCD**：`Rigidbody.collisionDetectionMode = Continuous`（防穿静态碰撞体）/ `Continuous Dynamic`（含动态体）/ `Continuous Speculative`（性能更好）。只对少量高速物体开，避免全局开销。
3. **移动别直接改 `transform.position`**：直接改位置等于瞬移，物理引擎检测不到中间过程；用 `Rigidbody.MovePosition`/`AddForce` 走物理管线。
4. **移动前预检测**：自控移动时先 `SphereCast`/`CapsuleCast` 探测前方，命中则贴合到碰撞点前，防止"进墙"。
5. **兜底**：限制单步位移（最高速度 ≤ 碰撞体最小厚度 × 步长）；或仅近处物体开 CCD。

**要点**：优先"射线/扫掠自判 + CCD 定向开启"；避免"放大碰撞体（改变判定表现）、全局减小 FixedDeltaTime（CPU 开销大且治标不治本）"。

### 6.2.9 MeshCollider 与其他 Collider 的主要区别

- **MeshCollider**：根据网格（Mesh）的**顶点数据**创建，能精确反映网格真实形状，但计算量大、顶点数据多。
- 其他（BoxCollider / SphereCollider / CapsuleCollider）：基于**简单几何形状**（算法计算），性能好，碰撞不精确。
- 结论：追求性能用基本碰撞体组合，追求精确用 MeshCollider。

### 6.2.10 物理更新位置

- **机制**：引擎累积缩放后的游戏时间，每满一个步长（`Time.fixedDeltaTime`，默认 0.02s）执行一次 `FixedUpdate`；固定的是**步长**而非每帧调用次数（一帧 0、1 或多次）；卡顿补算受 `Time.maximumDeltaTime`（约 0.333s）限制，防"死亡螺旋"。
- **与 timeScale**：累积的是缩放时间，`timeScale = 0` 时物理暂停；`timeScale` 不改变 `fixedDeltaTime` 数值（0.5 时步长仍 0.02s，现实约 25 次/秒，物理半速）。

> **注：** `FixedUpdate` 内 `Time.deltaTime` 等于固定步长，不是渲染帧耗时。

**职责划分（放哪个回调）**：

| 回调 | 调用频率 | 职责 | 适合内容 |
| --- | --- | --- | --- |
| Update | 每渲染帧一次（帧率相关） | 逻辑/输入 | 输入监听、状态切换、计时器、UI 更新 |
| FixedUpdate | 固定步长（默认 0.02s，与帧率无关） | 物理同步 | 刚体移动（`MovePosition`）、施力（`AddForce`）、碰撞/触发、需确定性的逻辑（网络同步） |
| LateUpdate | 每渲染帧一次（Update 之后） | 表现层 | 相机跟随、读取物理结果做插值表现 |

- **面试一句话**：物理放 `FixedUpdate`，输入逻辑放 `Update`，相机表现放 `LateUpdate`；固定的是步长，不是每帧调用次数。

### 6.2.11 Time.timeScale 详解

- **定义**：全局时间缩放系数，只作用于缩放时间：`Time.deltaTime ≈ unscaledDeltaTime × timeScale`（受 `Time.maximumDeltaTime` 约束）；=1 正常、<1 变慢、=0 停。

**timeScale = 0 时的对照表**：

| 类别 | 受影响（停止/暂停） | 不受影响（照常） |
| --- | --- | --- |
| 时间值 | `Time.deltaTime`/`Time.time`/fixed 累积 | `Time.unscaledDeltaTime`/`unscaledTime`/`realtimeSinceStartup` |
| 更新回调 | `FixedUpdate` 不触发 | `Update`/`LateUpdate` 照常每帧调用（输入、暂停菜单仍响应） |
| 物理 | 刚体、重力、碰撞（随 FixedUpdate 停） | — |
| 协程 | `WaitForSeconds`（永不完成） | `WaitForSecondsRealtime` |
| 动画/粒子 | Animator（默认）、粒子（默认） | `UnscaledTime` 模式的动画/粒子 |
| 表现 | — | UI 渲染；音频默认不停（暂停需 `AudioListener.pause = true`） |
| 其他 | — | 网络、真实计时器 |

- **实践**：暂停 = `Time.timeScale = 0`（恢复时还原原值）；暂停界面倒计时用 `unscaledDeltaTime`，延时用 `WaitForSecondsRealtime`。
- **面试一句话**：timeScale 只影响缩放时间；=0 时物理与缩放逻辑暂停，`Update`、输入、UI、音频仍工作。

> **注：** `timeScale = 0` 不等于禁用脚本：`Update` 仍执行，只是 `deltaTime = 0`。

## 6.3 UI 系统（UGUI）

### 6.3.1 Canvas 的三种渲染模式

| 模式 | 特点 | 适用场景 |
| --- | --- | --- |
| Screen Space - Overlay（覆盖） | UI 直接绘制在屏幕最上层，不受摄像机影响；无需关联摄像机；自动适配屏幕分辨率 | 菜单、HUD 血条等简单 2D UI，UI 始终可见 |
| Screen Space - Camera（摄像机） | UI 通过指定摄像机渲染，可应用后期处理（模糊、景深）；位置随摄像机视口变化；需手动关联摄像机 | 需要 UI 与摄像机视角联动、特殊视觉效果 |
| World Space（世界空间） | UI 作为 3D 物体存在于场景，可自由调整位置/旋转/缩放；必须手动设置 RectTransform；需关联摄像机渲染 | 3D 场景中的交互 UI（游戏内显示屏、头顶对话框）、VR/AR |

### 6.3.2 Canvas Scaler 的缩放模式（多分辨率适配）

| 模式 | 行为 |
| --- | --- |
| Constant Pixel Size | 保持 UI 像素大小不变，与屏幕尺寸无关 |
| Scale With Screen Size（推荐） | 根据参考分辨率动态缩放，屏幕越大 UI 越大（设置参考分辨率和匹配模式） |
| Constant Physical Size | 保持 UI 物理尺寸一致，与屏幕分辨率无关（按 DPI 缩放） |

- 适配要点：① 选择渲染模式；② 配置 Canvas Scaler（Scale With Screen Size）；③ 配置锚点（Anchors）与轴心点（Pivot）；④ 使用 Layout Group 自动排列。
- 历史方案（NGUI）：计算屏幕宽高比与原预设分辨率的比值，调整摄像机 size（NGUI 为历史第三方插件，现主流为 UGUI）。

### 6.3.3 UGUI 合批条件与渲染顺序

- **合批条件**：同一 Canvas 下，需要**相同材质、相同纹理（图集）、相同 Z 值（深度）**。
- 反例：UI 文字使用字体图集，与普通 UI 图集不同 → 无法合批；UI 动态更新会引起网格重绘 → 需要动静分离。
- **渲染顺序**：
  1. 不同 Canvas 之间：按 **Sort Order**；
  2. 同一 Canvas 内：按 **Hierarchy 中的顺序**（后绘制在上层）；
  3. 其他因素：Sorting Layer、Order in Layer、Z 轴、Shader 等。

### 6.3.4 UGUI 动静分离的实现原理

- 核心：静态 UI 不频繁变化，动态 UI 需要实时更新。
- 实现：
  1. **分层渲染**：静态与动态 UI 分到不同的 Canvas；
  2. **资源预加载/按需加载**：静态 UI 提前加载，动态 UI 按需加载；
  3. **UI 合批**：合并静态 UI，动态 UI 使用相同材质和纹理；
  4. **脏矩形技术**：仅重绘发生变化的区域。

### 6.3.5 Image 与 RawImage 的区别

- `Image`：只能使用 **Sprite** 类型图片；支持 Image Type（Simple/Sliced/Tiled/Filled）裁剪、平铺、旋转等操作；适合有交互/九宫格需求的 UI。
- `RawImage`：可显示任意 Texture（不限于 Sprite）；性能开销小，适合单独展示的图片。
- 原笔记说法："Image 比 RawImage 更消耗性能"——准确说是 Image 功能更丰富、处理更重，简单展示用 RawImage 更轻。

### 6.3.6 Text 与 TextMeshPro（TMP）的区别

- `Text`（旧版）：**像素渲染**，放大后会模糊；父物体缩放会影响子物体 Text 清晰度；更换文字消耗小。
- `TMPText`：**网格渲染**，把字体生成类似贴图的数据，读取贴图坐标获取文字；缩放不模糊；大量文字性能更高；但更换文字、查找字体消耗比 Text 大，字体库很大时更明显。
- 结论：经常变动的文字用 Text（消耗小），量大且基本不变的文字用 TMP（渲染质量与性能好）。

### 6.3.7 Mask 与 RectMask2D 的区别

| 对比项 | Mask | RectMask2D |
| --- | --- | --- |
| 实现方式 | 使用**模板缓冲区**（Stencil）记录裁剪区域，子元素通过模板测试后才渲染 | 直接使用**矩形区域**裁剪，超出矩形部分不渲染 |
| 适用场景 | 复杂形状裁剪（圆形、多边形、不规则图案） | 矩形区域裁剪（列表、滚动区域） |
| 性能 | 较低（模板测试、可能打断合批） | 较高 |

### 6.3.8 图集与纹理类型

- 图集（Atlas）：把多张小图合并成一张大纹理，减少 DrawCall。
- TextureType：**Sprite** 作为 UI 精灵使用；**Texture** 作为模型贴图使用。
- 动态图集机制（优化题）：运行时把散图动态打包到一张大图集，需要时从图集获取 Sprite 并建立映射关系。

### 6.3.9 UGUI 优化汇总

**渲染优化（减少 DrawCall）**

1. 图集合并（多张小图 → 一张大图集）；
2. 减少 Mask 组件使用（打断合批）；
3. 禁用不必要的 **Raycast Target**；
4. 合并 Canvas（减少 Canvas 数量，动静分离）。

**布局与层级优化**

1. 避免频繁布局重建（Layout Group 会触发布局重建，动态内容慎用）；
2. 层级扁平化（嵌套过深增加遍历开销）。

**资源优化**：图片压缩、九宫格、避免大纹理、对象池复用 UI 元素。

### 6.3.10 2D 游戏实现方式 / 原生 GUI 替代

- 用 UGUI 实现 UI（Unity 官方 UI 系统）。
- 摄像机投影改为**正交投影（Orthographic）**，不考虑 Z 轴。
- 使用 Unity 2D 模式（正交摄像机 + Sprite）。
- 使用第三方插件：NGUI、2D Toolkit。
- **为什么移动设备上要替代原生 GUI（OnGUI）**：不美观、OnGUI 每帧调用很耗费时间、使用不方便、DrawCall 高。

### 6.3.11 动态字体 vs 静态字体（dynamic font / static font）

- Unicode 是可以容纳世界上所有文字和符号的字符编码方案。
- **动态字体**：按需加载字符，不需要预先生成所有字符的纹理，支持亚洲语言等大字符集时**内存占用小**；可动态调整大小形状；有缓存机制减少重复加载开销。
- **静态字体**：需要预生成完整字符纹理，字符集大时纹理非常大。

### 6.3.12 UGUI 整体架构与渲染管线

- 本质：基于 `GameObject + Component` 的**保留模式** UI 系统——维护层级和状态，在需要时完成布局计算、网格生成、合批、渲染与事件分发。

| 子系统 | 主要职责 | 核心类 |
| --- | --- | --- |
| UI 空间与层级 | 位置、大小、锚点、父子关系 | `RectTransform`、`Canvas` |
| 图形生成 | 把 Image/Text 转成顶点与三角形 | `Graphic`、`Image`、`Text`、`VertexHelper` |
| 渲染与合批 | 提交网格/材质/纹理，构建批次 | `CanvasRenderer`、`Canvas` |
| 布局系统 | 计算子节点尺寸位置与自适应 | `LayoutRebuilder`、`LayoutGroup`、`ContentSizeFitter` |
| 输入事件 | 射线检测与点击、拖拽、滚动分发 | `EventSystem`、`GraphicRaycaster`、`ExecuteEvents` |

**渲染管线**：

```text
GameObject UI 层级 → RectTransform 布局计算 → Graphic 生成顶点/UV/颜色/三角形
→ CanvasRenderer 保存渲染数据 → Canvas 排序、裁剪、合批 → 提交渲染系统
```

- 布局、脏标记、网格生成、事件系统由 C# 实现；`Canvas`/`CanvasRenderer` 与最终提交进入引擎原生层。

### 6.3.13 RectTransform 底层逻辑

- 用 `RectTransform` 代替 `Transform` 描述矩形 UI。
- 关键属性：`anchorMin`/`anchorMax`（锚点范围）、`pivot`（变换中心）、`anchoredPosition`（相对锚点偏移）、`sizeDelta`（相对锚点矩形的尺寸差）、`offsetMin`/`offsetMax`（拉伸模式下的边界偏移）、`rect`（最终局部矩形）。
- **锚点原理**：
  - `anchorMin == anchorMax`（固定锚点）：最终尺寸 ≈ sizeDelta；
  - 锚点拉开（拉伸）：最终尺寸 = 父节点尺寸 × 锚点范围 + sizeDelta。
  - 所以**同一个 sizeDelta 在拉伸/非拉伸模式下含义不同**。
- 父节点尺寸、锚点、Pivot 或布局变化会触发子节点矩形重算，回调 `OnRectTransformDimensionsChange()`——在回调里改尺寸需防递归更新。

### 6.3.14 Graphic 网格生成与 CanvasRenderer

**继承关系**：`UIBehaviour → Graphic → MaskableGraphic → Image / RawImage / Text`（MaskableGraphic 才支持 Mask、RectMask2D 裁剪）。

**Graphic 职责**：维护颜色/材质/纹理；判断是否更新网格；生成 UI 顶点；参与射线检测；向 CanvasRenderer 提交网格与材质；响应裁剪、Mask、Canvas 状态变化。

**网格生成**：UI 图形本质是三角形网格——矩形 Image = 4 顶点 + 6 索引 + 2 三角形；顶点含 Position / Color / UV0 / UV1~3（按 Shader 需要）/ Normal / Tangent。

```csharp
protected override void OnPopulateMesh(VertexHelper vh)
{
    vh.Clear();
    // 添加顶点与三角形索引
}
```

- `Image.Type` 影响网格生成：`Simple`（矩形）、`Sliced`（九宫格，顶点更多）、`Tiled`（平铺，大区域小纹理时顶点暴涨，慎用）、`Filled`（按填充比例重算）、`Preserve Aspect`（保持宽高比）。

**CanvasRenderer**：保存并提交 UI Mesh、材质、纹理、透明度、裁剪状态、剔除状态。分工：Graphic 决定画什么 → CanvasRenderer 提交数据 → Canvas 组织排序/裁剪/合批/绘制（CanvasRenderer 不是普通 MeshRenderer，由 Canvas 系统统一管理）。

### 6.3.15 脏标记与 Canvas 重建机制

- UGUI **不每帧无条件重建**，而是用脏标记 + 延迟重建。

| 方法 | 影响 |
| --- | --- |
| `SetVerticesDirty` | 顶点/UV/几何数据重新生成 |
| `SetMaterialDirty` | 材质/纹理/裁剪参数更新 |
| `SetLayoutDirty` | 尺寸与布局重算 |
| `SetAllDirty` | 布局、顶点、材质全部更新 |

- `CanvasUpdateRegistry` 维护两类重建队列：**Layout Rebuild Queue** 与 **Graphic Rebuild Queue**。
- CanvasUpdate 阶段：`Prelayout → Layout → PostLayout → PreRender → LatePreRender`。

```text
尺寸/内容变化 → 置脏标记 → 加入 CanvasUpdateRegistry
→ 渲染前先 Layout 重建 → 再 Graphic 网格/材质重建 → 重算批次 → 提交渲染
```

- `Canvas.ForceUpdateCanvases()` 强制立即更新（需要马上取布局结果的场景），**不要在 Update 中频繁调用**，否则破坏延迟合并更新的优势。

### 6.3.16 布局系统实现原理

- 两个接口：`ILayoutElement`（"我想占多大"：min/preferred/flexible 宽高；实现：LayoutElement、Image、Text、ContentSizeFitter 相关）+ `ILayoutController`（"怎么安排子节点/自身"：`ILayoutSelfController`/`ILayoutGroup`；实现：Horizontal/Vertical/Grid LayoutGroup、ContentSizeFitter、AspectRatioFitter）。
- `LayoutRebuilder`：从脏节点**向上查找有效布局根节点**再按序重建（水平先、垂直后）。
- 性能问题：一次属性修改触发**多层父节点重复查找与重建**，而非单个 LayoutGroup 慢。
- 慎用组合：`ContentSizeFitter + LayoutGroup`、多层嵌套 LayoutGroup、脚本持续修改 RectTransform、父子尺寸互相依赖（父依赖子且子依赖父的循环）。

### 6.3.17 事件系统实现原理

**组成**：EventSystem + InputModule + Raycaster + ExecuteEvents。

```text
输入 → EventSystem 更新 InputModule → InputModule 发起 Raycast
→ GraphicRaycaster 检测 Graphic → 排序后的 RaycastResult → ExecuteEvents 向目标及父层级分发
```

- 输入模块：`StandaloneInputModule`（旧 Input Manager）、`InputSystemUIInputModule`（新 Input System）。
- GraphicRaycaster 检查：raycastTarget 开启、Graphic 激活、未被剔除、点在 RectTransform 内、`ICanvasRaycastFilter`、Mask/CanvasGroup 规则、深度与排序。
- 事件接口：`IPointerClickHandler`、`IPointerDown/Up/Enter/Exit`、`IBeginDrag/IDrag/IEndDrag`、`IScroll`、`ISubmit`、`ICancel`；由 `ExecuteEvents` 分发，部分事件向父级查找可处理对象。

### 6.3.18 Mask 与裁剪原理（补充 §6.3.7）

- **Mask（Stencil）**：Mask 图形向模板缓冲区写入值 → 子节点用修改后的材质 → Shader 做 Stencil 比较 → 通过测试的像素才显示。
  - 缺点：产生额外材质变体、**打断合批**、嵌套 Mask 增加模板层级与材质复杂度、Mask 自身可能额外参与绘制。
- **RectMask2D**：基于矩形裁剪信息 + CanvasRenderer 裁剪，不依赖 Stencil；适合 ScrollRect 等矩形区域、更轻；**只能矩形裁剪**（圆形/不规则不行）。
- 结论：矩形裁剪优先 `RectMask2D`。

### 6.3.19 Canvas 合批原理（补充 §6.3.3）

**影响合批的因素**：材质、纹理（图集）、Shader 与关键字、裁剪状态、Stencil 参数、层级渲染顺序、空间重叠、嵌套 Canvas、特殊材质/额外纹理。

- **层级顺序不能乱**：`Image A(图集1) → B(图集2) → C(图集1)`，若 B 与 A/C 有覆盖关系，Canvas 不能跨过 B 合并 A、C——同图集元素尽量相邻，但**不能为合批破坏正确显示顺序**。
- **SpriteAtlas**：同一图集提高合批机会，但不保证合批（材质/Mask/顺序仍可能拆批）；大图集增加显存与加载压力；按界面、生命周期、使用场景合理拆分图集。

### 6.3.20 UGUI 性能开销分类

- **CPU**：Canvas 重建、Layout 重建、Graphic 网格重建、Text 字符网格生成、批次重算、GraphicRaycaster 射线、ScrollRect 大量节点、Instantiate/Destroy/SetActive、频繁改 RectTransform。Profiler 常见项：`Canvas.BuildBatch`、`Canvas.SendWillRenderCanvases`、`CanvasUpdateRegistry.PerformUpdate`、`LayoutRebuilder.Rebuild`、`Graphic.Rebuild`、`GraphicRaycaster.Raycast`。
- **GPU**：DrawCall 过多、半透明 Overdraw、全屏半透明层叠加、Mask/复杂 Shader、模糊/描边/阴影、高分辨率高填充率、World Space 双面或远距离渲染、大面积不可见 UI 仍被绘制。
- **内存/加载**：大尺寸纹理、图集利用率低、重复加载、字体图集过大、动态字体持续扩容、频繁 Instantiate/Destroy 与临时对象 GC。

### 6.3.21 UGUI 优化方法

1. **拆分 Canvas（动静分离）**：静态（背景/装饰）与动态（血条/倒计时/滚动列表）分 Canvas；按**更新频率、生命周期、遮挡关系**拆，不要每控件一个 Canvas（Canvas 有管理成本、之间不能合批）。
2. **减少 Layout 重建**：少嵌套 LayoutGroup/ContentSizeFitter、高频项固定尺寸、批量修改后只刷一次、别每帧 `ForceRebuildLayoutImmediate`/`Canvas.ForceUpdateCanvases`；仅开界面时用布局：启用 → 布局 → 禁用 → 直接用算好的位置。
3. **控制 Canvas 重建**：事件驱动更新、赋值前比较新旧值、同帧多次修改合并一次、少改父子层级/SetSiblingIndex、动画区与静态区拆分、别持续更新不可见 UI。
4. **优化 Raycast**：关闭背景/装饰/图标/不可交互文本的 Raycast Target（一个按钮只需主 Graphic 接收）；整组禁交互用 `CanvasGroup`（interactable=false、blocksRaycasts=false）；无交互 Canvas 移除 GraphicRaycaster；避免多余 EventSystem。
5. **ScrollRect 长列表**：**虚拟列表/循环列表**（万条数据只建 10~20 个 Item，滚动复用）；Item 对象池、固定高度直接算位置、不用 LayoutGroup 实时排列、滚动只更新可见项、RectMask2D 裁剪、关无用 Raycast Target。
6. **优化 Text**：别每帧刷无变化文本（如只显示秒的倒计时，秒变才更新）；少 AutoSize/富文本/阴影/描边；高频数字避免字符串分配；数字区域固定宽度防布局抖动；合理配置 TMP 字体图集、可预知字符预生成。
7. **降低 Overdraw**：删被完全遮挡的底层图片、别用 `alpha = 0` 代替真正禁用、避免多个全屏半透明层叠加、裁剪 Sprite 透明空白、静态复杂装饰合并成一张、弹窗完全遮住底层时停底层 Canvas 绘制。
8. **减少 Mask**：优先级 `不裁剪 > RectMask2D > Mask/Stencil > 多层嵌套 Mask`；别给每个列表项单独加 Mask；不规则遮罩考虑 Shader 裁剪或预处理。
9. **图集与材质**：同界面 Sprite 放同一/少量图集、按加载生命周期拆图集、避免运行时给 Image 实例化独立材质、共享材质、控制 Shader Keyword；只改颜色用**顶点色/Graphic.color**，别创建材质实例。
10. **对象池与生命周期**：飘字、聊天气泡、列表项、红点、Toast、弹幕等池化，避免频繁 Instantiate/Destroy（CPU 峰值 + 内存分配 + GC + Canvas/Layout 重建）；回池清理事件监听、动画状态、控件状态、异步请求。

### 6.3.22 重要类速查

**渲染**：`Canvas`（渲染根节点，排序/缩放/模式）、`CanvasRenderer`（提交网格/材质/裁剪）、`Graphic`（基类：脏标记/材质/网格/射线）、`MaskableGraphic`（支持裁剪）、`Image`（Sprite/九宫格/平铺/填充）、`RawImage`（直接显示 Texture）、`VertexHelper`（构建顶点索引）、`CanvasScaler`（分辨率适配）。

**更新注册**：`CanvasUpdateRegistry`（Layout/Graphic 重建队列）、`ICanvasElement`（可重建对象接口）、`GraphicRegistry`（记录 Graphic）、`ClipperRegistry`（裁剪组件）、`Registry<T>`（注册集合基类）。

**布局**：`LayoutRebuilder`、`LayoutUtility`（查询 min/preferred/flexible 尺寸）、`LayoutElement`、`Horizontal/Vertical/Grid LayoutGroup`、`ContentSizeFitter`、`AspectRatioFitter`。

**事件**：`EventSystem`、`BaseInputModule`、`StandaloneInputModule`（旧输入系统）、`InputSystemUIInputModule`（新输入系统）、`GraphicRaycaster`、`ExecuteEvents`（事件分发）、`PointerEventData`（指针状态）、`CanvasGroup`（透明度/交互/射线阻挡）。

### 6.3.23 UGUI 性能排查与优化优先级

**排查步骤**：① Profiler 判断 CPU 还是 GPU（`Canvas.BuildBatch`/Layout 高 → CPU；DrawCall/GPU 时间/Overdraw 高 → GPU）→ ② 查 Canvas 重建（哪些每帧变、动静是否分离、每帧文本/改 RectTransform）→ ③ 查 Layout（嵌套、ContentSizeFitter、每帧强制刷新）→ ④ Frame Debugger/RenderDoc 查 DrawCall 与拆批原因 → ⑤ Overdraw 视图查透明叠层 → ⑥ **真机验证**（编辑器 ≠ 真机：填充率、图集显存、字体图集、IL2CPP、不同渲染管线与驱动差异）。

**优化优先级**：找每帧重建的 Canvas → 动静拆分 → 停无变化文本/属性重复赋值 → 长列表虚拟化 + 对象池 → 减 Layout 嵌套 → 关无用 Raycast Target → RectMask2D → SpriteAtlas 减少材质纹理切换 → 删全屏透明叠层降 Overdraw → 最后才考虑自定义 Mesh/Shader/换框架。

> **核心原则：少重建、少布局、少节点、少射线、少透明覆盖、少材质切换。** 优化不能只看 Draw Call——真正的瓶颈常在 Canvas 重建、布局计算、文本刷新与长列表节点数量，先定位再优化。

## 6.4 动画系统

### 6.4.1 游戏动画的几种方式及原理

1. **关节动画**：把角色分成若干独立部分，每部分对应一个网格模型，各部分的动画连接成整体动画（角色较灵活，Quake2 使用）。
2. **骨骼动画**：最广泛应用。骨骼按角色特点组成层次结构，由关节相连可做相对运动；皮肤作为单一网格蒙在骨骼之外决定外观；每个顶点受多个骨骼影响（权重），实现平滑变形（由关节动画发展而来）。
3. **单一网格模型动画（关键帧动画）**：由一个完整网格模型构成，关键帧里记录各顶点的原位置及其改变量，通过插值实现动画（角色动画较真实）。

### 6.4.2 SkinnedMesh 的实现原理

- 蒙皮网格动画分**骨骼**和**蒙皮**两部分：
  - 骨骼：层次结构，存储骨骼的 Transform 数据；
  - 蒙皮：网格顶点附着在骨骼之上，顶点可被多个骨骼影响（带权重）；需要将顶点从 Mesh 空间变换到骨骼空间，再按骨骼权重混合。

### 6.4.3 Animation 与 Animator 的区别

- `Animation`：控制**单个**动画的播放（旧版组件）。
- `Animator`：多个动画之间的**切换**（动画状态机），有动画控制器（Animator Controller）；功能强大，但**占用内存比 Animation 大**。

### 6.4.4 Animator 的 Layer 作用与使用时机

1. **动画叠加与混合**：不同 Layer 独立控制角色不同部位（如上半身攻击、下半身奔跑），通过**权重（Weight）**和**遮罩（Avatar Mask）**混合多个动画；
2. **优先级控制**：每个 Layer 可设置权重和执行顺序，高优先级 Layer 覆盖低优先级动画；
3. **逻辑解耦**：把不同功能的动画拆到不同 Layer（基础移动、技能动作、表情），提升状态机可维护性。

### 6.4.5 Avatar 的作用

- Avatar：用户提供的模型骨架与 Unity 骨架结构的**适配映射关系**，方便动画**重定向（Retargeting）**。
- AnimationType：**Humanoid**（人形，支持动画重定向）、**Generic**（非人形）、**Legacy**（旧版动画）。
- **Avatar Mask（身体遮罩）**：控制身体某部分是否受动画影响。
- **IK（反向动力学）**：通过手/脚等末端位置反推身体其他部分（如手抓物体、脚踩地面）。

### 6.4.6 Animation 常用方法与 API

- `AddClip`：把 Clip 添加到动画。
- `Blend`：在指定时间内将某动画向目标权重混合。
- `CrossFade`：在指定时间内使目标动画淡入、其他动画淡出（动画切换）。
- `CrossFadeQueued`：在上一个动画播放完成后交叉淡入淡出。
- `Play` / `PlayQueued`：播放 / 排队播放。
- `IsPlaying`：判断动画是否正在播放。
- `RemoveClip` / `Sample` / `Stop` 等。
- **反向旋转动画**：将动画速度调成 -1（`animation.speed = -1`）。
- `Animation.CrossFade` 的作用：动画淡入淡出（A 动画淡入，其他动画淡出）。

## 6.5 协程

### 6.5.1 什么是协程 / 协程的作用

- 协程是**伴随主线程运行**的一段程序（不是线程），在单线程内通过 `yield` **分时分段**执行，避免一帧内做大量工作导致卡顿。
- 作用：主线程执行耗时操作时会帧率下降、画面卡顿；协程把任务拆成多帧完成，辅助主线程，避免卡顿。
- 协程在**脚本失活时不会停止运行**，在**对象失活/销毁时停止**。

### 6.5.2 协程的底层原理

- 核心是 **C# 迭代器 + 状态机**：
  - 方法返回 `IEnumerator` 且包含 `yield` 关键字时，编译器将其转换为一个**状态机类**，保存局部变量和执行位置；
  - 核心方法是 `MoveNext()`：`yield` 之前的代码在第一次 MoveNext 执行，`yield` 之后的代码在第二次 MoveNext 执行；
  - Unity 在**每一帧的生命周期中**判断当前帧是否满足协程条件（延迟时间、等待条件等），满足则抽出 CPU 时间执行一次 MoveNext。
- Unity 维护一个协程队列；每帧遍历队列，检查协程是否应停止或恢复；协程状态（局部变量、执行位置）保存在生成的状态机类中，恢复时从上次暂停位置继续。

### 6.5.3 协程与线程的区别

| 对比项 | 协程 | 线程 |
| --- | --- | --- |
| 本质 | 单线程内的分时协作（用户态） | 操作系统调度的并行执行单元 |
| 同一时刻 | 只有一个协程在运行 | 多个线程可同时运行（多核） |
| 能否访问 Unity API | 可以（运行在主线程） | 不能（子线程禁止访问 Unity 对象/组件） |
| 开销 | 极小，开多个协程开销不大 | 大，开辟线程开销大 |
| 调度 | 主动让出（yield） | 操作系统抢占 |
| 适用 | 分时处理任务、延时、异步加载 | CPU 密集运算、网络收发（需注意线程安全） |
| 阻塞 | 不是真线程，可能发生堵塞 | 阻塞式 |

### 6.5.4 什么时候用协程、什么时候用多线程

- **协程**：延时操作、分帧处理、异步任务（配合异步加载）、等待条件。
- **多线程**：CPU 密集型任务（图像处理、物理模拟）、文件读写、网络通信、需要实时响应的后台任务。

### 6.5.5 Awake 中启动协程的问题

- 原笔记说法"对象实例化时执行 Awake，对象没实例化好就去调用会报错"**不准确**：
  - 准确说法：协程可以在 Awake 中启动（官方文档允许），但**官方建议在 Start 中启动**；
  - 若 GameObject 处于**非激活**状态，`StartCoroutine` 无法启动协程（会失败）。

### 6.5.6 启动与停止协程的 API

```csharp
StartCoroutine(方法名(string));            // 通过方法名字符串启动
StartCoroutine(方法名(string), 参数);       // 带参数字符串启动
StartCoroutine(IEnumerator routine);       // 通过 IEnumerator 启动（推荐，可带参）

StopCoroutine(string methodName);          // 通过方法名停止
StopCoroutine(IEnumerator routine);        // 通过 IEnumerator 停止
StopCoroutine(Coroutine routine);          // 通过 Coroutine 对象停止
StopAllCoroutines();                       // 停止该脚本启动的所有协程
```

### 6.5.7 Unity 定时器实现方式

1. `InvokeRepeating("方法名", 延迟, 间隔)`；
2. 协程：`yield return new WaitForSeconds(时间)`；
3. `Update` 中手动累积时间（`Time.deltaTime`）——最精细可控。

## 6.6 资源与数据

### 6.6.1 常用资源路径

| API | 路径含义 |
| --- | --- |
| `Application.dataPath` | Assets 文件夹的绝对路径（只读） |
| `Application.streamingAssetsPath` | StreamingAssets 文件夹的绝对路径（只读，需先判断文件夹存在） |
| `Application.persistentDataPath` | 可读写的持久化数据目录（推荐存档/下载用） |

- `AssetDatabase`（编辑器 API）：对 Assets 下文件操作——`GetAllAssetPaths()` 获取所有资源（不含 meta）、`GetAssetPath(obj)` 获取相对路径、`Refresh()` 刷新、`GetDependencies(path)` 获取依赖。
- `Directory`（System.IO）：`Exists` / `CreateDirectory` / `Delete(path, true)` 等文件夹操作。
- 注：AssetDatabase 只在编辑器可用，运行时用 Resources/AssetBundle/Addressables。

### 6.6.2 PlayerPrefs

- 本地持久化保存/读取数据的类，支持三种类型：整型、浮点型、字符串型。
- `SetInt` / `GetInt`、`SetFloat` / `GetFloat`、`SetString` / `GetString`。

### 6.6.3 如何安全地在不同工程间迁移 Assets 数据

1. 将 **Assets 目录和 Library 目录**一起迁移；
2. 使用 Unity 的**导出包（Export Package）**功能（.unitypackage，含依赖）；
3. 使用 Unity 自带的 **Asset Server**（历史方案）或 Git 等版本控制工具（现代推荐）。

### 6.6.4 动态加载资源的方式

1. **Instantiate**：以实例化方式动态生成物体（需已有预制体引用）。
2. **Resources.Load**：从 Resources 文件夹加载指定类型的资源；**无论场景是否引用，Resources 下的资源都会打进安装包**；重复加载不会浪费内存（有缓存），但会浪费查找性能。
3. **AssetBundle**：将资源打成 AssetBundle 放在服务器或本地磁盘，运行时下载/加载（官方推荐，适合热更新）。
4. **AssetDatabase.LoadAssetAtPath**：仅编辑器有效（开发调试用）。
5. 现代方案：**Addressables**（基于 AB 的封装）。

### 6.6.5 AssetBundle 打包

```csharp
using UnityEditor;
using System.IO;

public class CreateAssetBundles {
    [MenuItem("Assets/Build AssetBundles")]
    static void BuildAllAssetBundles() {
        string dir = "AssetBundles";
        if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
        BuildPipeline.BuildAssetBundles(
            dir,                                              // 输出路径（必须已创建）
            BuildAssetBundleOptions.ChunkBasedCompression,    // 压缩类型
            BuildTarget.StandaloneWindows64);                 // 目标平台
    }
}
```

- 压缩选项：
  - **None**：不压缩（解压快、体积大，用于调试）；
  - **LZMA**：压缩率最高、加载最慢（需整体解压），适合发布/网络下载；
  - **ChunkBasedCompression（LZ4 分块）**：压缩率低于 LZMA，解压速度接近不压缩，适合运行时加载。

### 6.6.6 AssetBundle 加载的几种方式

1. `AssetBundle.LoadFromMemory(Async)`：从内存字节加载；
2. `AssetBundle.LoadFromFile(Async)`：从本地文件加载（推荐本地）；
3. `UnityWebRequest.GetAssetBundle(url)`：网络加载（现代推荐）；
4. `WWW.LoadFromCacheOrDownload(path, version)`：带缓存的网络加载（历史方案）；
5. 通过 **Manifest 文件**加载：读取 `AssetBundleManifest.GetAllDependencies` 加载依赖 AB。

### 6.6.7 AssetBundle 卸载

- `AssetBundle.Unload(bool)`：
  - `true`：卸载**所有**资源（包括正在使用的，谨慎使用）；
  - `false`：只卸载未使用的资源（正在使用的资源与 AB 的依赖关系会丢失），再调用 `Resources.UnloadUnusedAssets()` 释放无引用资源，或等场景切换时自动调用。

### 6.6.8 AB 包压缩算法对比

- **LZ4**：轻量级无损压缩，压缩/解压速度快，占用内存小，适合实时加载和移动端；压缩率一般。
- **LZMA**：高压缩率，但压缩/解压速度慢、需较多内存（整体解压），适合追求压缩率的发布包。
- **GZIP**：广泛使用的无损压缩，常用于压缩文本文件。
- 选择：追求速度与低内存 → LZ4；追求压缩率 → LZMA/GZIP；不需要压缩 → 不压缩。

### 6.6.9 ScriptableObject

- ScriptableObject 是**数据容器**，用于保存大量数据。
- 主要用处：把不变的数据存成资源，**避免实例化时数据拷贝**，减少运行时内存占用。
- 例：预制体上挂有存不变数据的 MonoBehaviour，每次实例化都会产生一次数据拷贝；改用 ScriptableObject 存储数据、通过引用访问，避免内存中的拷贝。
- 与 MonoBehaviour 不同：ScriptableObject 不能挂到 GameObject 上，而是保存为 **Assets 资源**；可在编辑器中保存数据。

### 6.6.10 资源热更新流程（Lua/AB 方案）

1. 从服务器下载**资源比对文件**（版本清单/manifest）；
2. 将下载的文件与本地资源比对文件比较，找出需要更新的 AB；
3. 删除本地旧的比对文件，下载新的 AB 包（配合 Lua 逻辑热更）。

### 6.6.11 其他资源问题

- **为什么组件上会出现数据丢失**：一般是组件上绑定的对象被删除了（引用失效）。
- **Prefab 的作用**：作为模板，对素材、脚本、参数做默认配置；运行时实例化；方便批量修改和团队协作；打包内容简化导出操作。
- **如何销毁一个 UnityEngine.Object 及其子类**：`Destroy(obj)`（延迟到帧末销毁）；编辑器内可用 `DestroyImmediate`（立即销毁）；销毁 GameObject 用 `Destroy(gameObject)`。
- **Resources.UnloadAsset 的前提条件（修正归类）**：
  1. 卸载对象必须是**单个资源**（不会卸载 GameObject 这类由组件集合而成的对象）；
  2. 该资源已加载到内存中；
  3. 该资源没有被使用（无引用）。

## 6.7 渲染

### 6.7.1 渲染管道（渲染管线）

定义：图形数据从输入（3D 模型顶点、纹理等）到输出（屏幕像素）所经历的完整流程。

1. **应用阶段（CPU）**：确定每帧需要渲染哪些对象（剔除、相机参数）；输出一批需要渲染的几何数据（顶点数据、索引数据、纹理坐标、法线信息）。
2. **几何阶段（GPU）**：对顶点做模型、视图、投影变换；顶点着色、裁剪等；将 3D 数据转为适合屏幕的 2D 数据（并行）。
3. **光栅化阶段**：把顶点组装成图元（三角形），把图元转换为屏幕像素，计算像素属性生成片元（并行）。
4. **像素处理阶段**：对片元精细着色；深度测试确定可见性；混合实现透明等效果；最终写入帧缓冲区。

（经典流程简写：本地坐标 → 视图坐标 → 背面剔除 → 光照 → 裁剪 → 投影 → 视口变换 → 光栅化。）

### 6.7.2 Unity 中的渲染管道类型

- **内置渲染管道**：早期默认，通用但定制性差。
- **通用渲染管道（URP）**：基于 SRP（可编程渲染管线），可一定程度自定义，性能好，移动端主流。
- **高清渲染管道（HDRP）**：面向高端平台，追求超高品质图形（需较强硬件）。

### 6.7.3 DrawCall 是什么？为什么减少 DrawCall 能提升性能？

- **DrawCall（绘制调用）**：CPU 向 GPU 发送的、指示渲染特定几何数据的指令；每次发送 DrawCall 的过程为一个渲染批次（Batch），分为**设置渲染状态（setPass）**和**调用绘制（Draw）**两部分。
- 提升性能的原因：
  - **CPU 侧**：每次 DrawCall 都要做状态设置和数据提交（渲染状态、顶点/索引数据传到显存）；
  - **GPU 侧**：过多且零碎的 DrawCall 使 GPU 频繁在不同渲染任务间切换，浪费并行计算能力。
- **为什么有时减少了 DrawCall 性能却没有提升**：
  - 内存压力增大：批处理合并渲染对象会带来内存占用增加；
  - 材质和着色器复杂度过高（瓶颈在像素处理/着色器，而非调用次数）；
  - 瓶颈转移（如 CPU 已经不是瓶颈）。

### 6.7.4 静态批处理与动态批处理

| 对比项 | 静态批处理 | 动态批处理 |
| --- | --- | --- |
| 适用对象 | 位置等属性运行时**不变**的对象（静态物体） | 动态移动的对象 |
| 原理 | 多个静态小模型合并成一个大模型（运行前合并，内存换性能） | 运行时自动把满足条件的对象合并成一次绘制 |
| 限制 | 对象不能太多；场景中位置不变 | 网格顶点属性总数**小于 900** 才可能被动态批处理；需相同材质 |
| 内存 | 增加内存 | 每帧 CPU 合并有开销 |
| 特点 | 限制较少，用内存换性能 | 限制较多，自动处理 |

- 共同前提：**使用同一个材质**。
- 不能合并的情况：材质不同、渲染状态差异过大、动态批处理条件不满足（顶点超限等）。
- 使用**图集**：把多张小 Sprite 合并成一张大纹理，让不同 UI 共用同一纹理实现合批。
- 优化建议：多张小纹理合并到大图集（Atlas）；树林草地等大量对象用动态批处理更合适；场景静态物体考虑静态批处理。

### 6.7.5 material 与 sharedMaterial 的区别

- `material`：当前 MeshRenderer 实例**使用的材质实例**；修改它时 Unity 会创建新的材质实例（实例化），不影响其他物体。
- `sharedMaterial`：指向**共享的材质实例**；修改它会**影响所有引用该材质的 MeshRenderer**，并改变工程里存储的材质设置。
- 建议：想单独修改某物体材质用 `material`；批量修改用 `sharedMaterial`，但要小心影响范围。

### 6.7.6 Renderer / MeshRenderer / SkinnedMeshRenderer

- **Renderer**：抽象基类，所有渲染组件的基类，负责把游戏对象绘制到屏幕上。
- **MeshRenderer**：渲染普通网格；需配合 **MeshFilter**（存储网格数据）使用；适用于不变形的网格（建筑、地形）；可挂多个材质对应网格不同部分。
- **SkinnedMeshRenderer**：渲染带**骨骼动画**的网格；每个顶点可绑定多个骨骼实现平滑变形；支持批处理与 LOD 优化；适用于角色等需要实时动画的对象。

### 6.7.7 纹理压缩

- 纹理作用：通过映射增强物体表面细节，减少几何复杂度，提高渲染效率。
- 纹理压缩目的：**减少内存占用**（降低存储空间）、**提高带宽效率**（减少 GPU 与显存之间的数据传输）。
- 压缩方式：
  - **有损压缩**：丢弃部分数据（JPEG、DXT）；
  - **无损压缩**：保留全部数据，压缩率较低（PNG）；
  - **块压缩**：将纹理分小块分别压缩（DXT、ETC、ASTC）。
- 移动端推荐：**ETC**（Android 主流）、**ASTC**（桌面与移动通用，质量好）。

### 6.7.8 MipMap

- MipMap：把贴图预处理成一系列分辨率递减的图片（多级渐远纹理）。
- 作用：根据物体离摄像机距离选择合适精度的纹理——远处用低精度，减少显存带宽消耗、提高缓存命中率、防止远处像素闪烁（锯齿）。
- 代价：额外占用约 **1/3 内存**（256×256 会生成 2⁰~2⁸ 共 9 个层级，即逐级减半到 1×1）——典型的用空间换时间；UI 图片一般不需要开 MipMap。

### 6.7.9 LightMap（光照贴图）

- 预计算并存储静态场景的光照信息，运行时直接采样，减少实时光照计算。
- 优点：提高渲染效率（尤其全局光照）、增强视觉质量（可模拟环境光遮蔽、软阴影）、简化光照计算。
- 缺点：需要额外存储空间；主要适用于静态场景，动态物体/动态光源受限；光照变化需重新烘焙（更新成本）。

### 6.7.10 LOD（Level of Detail）

- 通过创建多个不同细节级别的模型，根据相机距离**动态更换模型**，提高渲染效率、降低运行时内存占用。
- 优点：提升渲染速度与性能、节省内存/显存、优化视觉效果。
- 缺点：增加开发工作量（准备多套模型）、切换时有潜在视觉瑕疵、场景中多个 LOD 对象可能增加内存消耗。

### 6.7.11 Unity 光源类型

- **平行光（Directional Light）**：模拟太阳，方向光，无位置衰减。
- **聚光灯（Spot Light）**：锥形范围，有位置和角度衰减。
- **点光源（Point Light）**：向四周发光，有距离衰减。
- **区域光源（Area Light）**：面光源，**只用于烘焙**（不参与实时光照）。

### 6.7.12 SetActive 为什么比较费性能（子物体多时）

- 需要**遍历所有子物体**；
- 可能涉及内存分配（组件依赖激活状态，如网格、材质实例）；
- 渲染组件（MeshRenderer/SpriteRenderer）激活/失活需要更新渲染管线状态；
- 有碰撞体时，物理引擎需要重新计算碰撞检测信息。
- 优化：尽量用"移出相机/停止渲染"、对象池、缓存 GameObject 状态代替频繁 SetActive。

## 6.8 摄像机

### 6.8.1 两种投影方式

- **透视投影（Perspective）**：近大远小，符合人眼视觉，用于 3D 场景。
- **正交投影（Orthographic）**：平行投影，无近大远小，用于 2D 游戏、UI、俯视视角。

### 6.8.2 场景中放置多个 Camera 并同时处于活动状态

- 画面由多个摄像机的画面**合成**；最终效果受 **Depth（深度，决定渲染顺序）、Clear Flags（清除标志，决定背景如何处理）、Culling Mask（剔除掩码，决定渲染哪些层）** 影响。

### 6.8.3 移动相机动作放在哪个函数？为什么？

- 放在 **LateUpdate**：它在所有 Update 结束后调用，适合相机跟随等依赖其他对象最终状态的逻辑——否则可能出现相机已移动、但视野中角色还没更新到的"空帧"。

## 6.9 数学与旋转

### 6.9.1 Transform 组件

- Unity 中用于记录节点空间几何信息（位置、旋转、缩放）的组件是 **Transform**，其父类是 **Component**。
- `localPosition`：相对于**父级**的位置；`position`：**世界坐标**位置。
- 物体自旋转：`transform.Rotate(...)`；物体绕某点旋转：`transform.RotateAround(点, 轴, 角度)`。

### 6.9.2 四元数与欧拉角

- **欧拉角**：① 表示同一旋转不唯一（60° 和 420° 方向相同）；② 会发生**万向节死锁**。
- **四元数**：不存在万向节死锁；表示旋转唯一（-180°~180°）。
- 优点：能进行增量旋转、避免万向锁、表达方式固定（给定方位的表达方式有两种，互为负）。
- 运算：两个四元数相乘得到新四元数（相对自身坐标系的旋转）；四元数乘以向量 = 旋转向量。

## 6.10 优化专题

### 6.10.1 对象池（Object Pool）

- **优点**：减少对象创建/销毁开销；降低 GC 压力；提高响应速度；资源管理可控。
- **缺点**：内存占用高（预分配对象）；代码复杂度增加；对象状态管理有风险（需彻底重置状态）。
- **适用**：高频创建/销毁的对象（子弹、特效、敌人）、初始化成本高的对象。
- 做法：游戏开始时预先实例化足够数量，用的时候取、不用的时候回收。

### 6.10.2 如何优化内存

1. 压缩自带类库、压缩资源（贴图压缩、音频压缩）；
2. 将暂时不用但以后还要用的物体**隐藏**而不是 Destroy；
3. 释放 AssetBundle 占用的资源（Unload）；
4. 降低模型面数、骨骼数量、贴图大小；
5. 使用光照贴图（LightMap）、LOD、着色器（Shader）、Prefab；
6. 使用对象池减少运行时创建；
7. 用 ScriptableObject 避免数据拷贝；
8. 及时卸载未使用的资源（Resources.UnloadUnusedAssets）。

### 6.10.3 如何减少 DrawCall

1. 图集合并（多张小图 → 一张大图集）；
2. 静态批处理 / 动态批处理；
3. 减少 Mask、禁用多余 Raycast Target；
4. 合并 Canvas、动静分离；
5. 相同材质、相同纹理的对象尽量同时渲染。

### 6.10.4 优化 DrawCall 是优化 CPU 还是 GPU？

- 主要影响 **CPU 性能**（减少状态设置与数据提交），但**间接影响 GPU 表现**（减少频繁切换，GPU 渲染更连续）。

### 6.10.5 背包 300 个物品如何初始化

- 使用**对象池 + 列表复用（虚拟列表/循环列表）**：只实例化可见数量的格子，滚动时复用；配合懒加载（滚动到才加载数据/图标）与图集合批，避免一次性创建 300 个完整 UI 对象。

### 6.10.6 场景渲染剔除技术

- 视锥剔除（Frustum Culling）、遮挡剔除（Occlusion Culling）、距离剔除（LOD/按距离隐藏）、按层/按 Tag 剔除（Culling Mask）。

### 6.10.7 LOD 与 MipMap 概念、区别、优缺点

- 见 §6.7.8（MipMap）与 §6.7.10（LOD）。核心区别：LOD 换**模型网格**细节，MipMap 换**纹理**精度；两者都是"距离越远细节越低"的空间换性能手段。

## 6.11 常用 API 与编程题

### 6.11.1 组件操作

- 获取组件：`GetComponent<T>()` / `GameObject.GetComponent<T>()`；
- 增加组件：`AddComponent<T>()`；
- 删除组件：`Destroy(组件)`；
- 获取对象上某个脚本的方法：先 `GetComponent<脚本类型>()` 再调用其方法。
- 查找对象：`GameObject.Find("名字")`（全局，性能差）；`Transform.Find("子节点名")`（相对查找）。
- 原生 GUI 可拖动窗口：`GUI.DragWindow()`（配合 `GUI.Window` 使用）。

### 6.11.2 Mathf 常用函数

- `Mathf.Round`：四舍五入；`Mathf.Clamp`：限制范围；`Mathf.Lerp`：插值。

### 6.11.3 计时器工具（00:00:00）

- 从整点开始计时：在 Update 中累加 `Time.deltaTime`，用 `TimeSpan.FromSeconds(t)` 格式化为 `HH:mm:ss`。

### 6.11.4 鼠标拖动物体 + 滚轮缩放（上机题思路）

- 拖拽：`Input.GetMouseButtonDown(0)` 时用摄像机向鼠标发射射线（`Camera.ScreenPointToRay`）获取目标；按住时根据鼠标屏幕位移换算世界位移移动物体。
- 缩放：`Input.GetAxis("Mouse ScrollWheel")` 修改物体的缩放或相机的 orthographicSize/FOV。

### 6.11.5 第三人称角色控制器（思路）

- 使用 CharacterController 或 Rigidbody；读取 `Input.GetAxis("Horizontal"/"Vertical")` 得到输入向量；旋转方向跟随相机朝向（`Camera.main.transform` 的 forward），`Move`/`SimpleMove` 移动角色；跳跃处理 `isGrounded` 与垂直速度。

### 6.11.6 吊机吊物体功能（思路）

- 射线检测点击的物体（`Physics.Raycast`），获取抓取点（相对偏移）；移动时使物体跟随吊钩/指针位置（`transform.position = 目标位置 + 偏移`）；放下时释放。

### 6.11.7 判断两个平面是否相交（不用碰撞体）

- 数学方法：两平面方程（法向量 n1、n2 与偏移 d1、d2）——若法向量不平行则两平面必相交于一条直线；若平行则比较偏移判断重合/平行不相交；或用两平面方程联立看是否有解。

### 6.11.8 抛物线运动（愤怒的小鸟思路）

- 初速度 v，每帧速度更新 `v' = v - new Vector3(0, g·t, f·t)`（g 为重力加速度、f 为空气阻力，均需自行调试），`transform.Translate(v')` 即可得到抛物线轨迹。

### 6.11.9 生命周期高频题速查

- 对象碰撞三阶段：Enter / Stay / Exit。
- 物理更新：FixedUpdate；相机跟随：LateUpdate。
- Awake 与 Start：Awake 实例化时调用，Start 在第一次 Update 前调用。
- OnEnable 可反复发生（每次 SetActive(true)）。
- **Time.timeScale = 0 时（暂停游戏）**：`Update` 不再按缩放时间推进、`FixedUpdate` 不执行（依赖 scaled time）、协程 `WaitForSeconds` 不推进；`Time.unscaledDeltaTime` 仍正常工作（可用于暂停菜单等不受影响的逻辑）。
