# 一、C# 语言

## 1.1 类型系统

### 1.1.1 值类型与引用类型的区别

| 对比项 | 值类型 | 引用类型 |
| --- | --- | --- |
| 存储位置 | 栈上，或作为对象的一部分存储在堆上 | 堆上；变量本身存的是指向堆对象的引用（地址） |
| 赋值/传递 | 复制一份副本，修改副本不影响原变量 | 传递引用副本，修改对象会影响原对象 |
| 释放方式 | 自动释放（作用域结束） | 需要触发 GC 回收 |
| 访问速度 | 快 | 慢 |
| 继承体系 | 继承自 `System.ValueType` | 继承自 `System.Object` |
| 典型类型 | `int`/`float`/`double`/`bool`/`char`/`enum`/`struct` | `class`/`string`/`array`/`delegate`/`interface` |

### 1.1.2 装箱与拆箱

- **装箱**：值类型 → 引用类型（栈 → 堆）。发生条件：值类型被赋给 `object` 或其他引用类型变量。
- **拆箱**：引用类型 → 值类型（堆 → 栈）。发生条件：装箱后的值被转回原始值类型。
- 装箱拆箱会产生**临时对象、增加 GC 压力**，应尽量避免（如用泛型 `List<T>` 代替 `ArrayList`）。

### 1.1.3 对象继承体系

- `System.Object`（object）是所有引用类型**和值类型**的最终基类。
- 所有值类型直接继承自 `System.ValueType`（`ValueType` 继承自 `object`）。
- 所有引用类型直接或间接继承自 `object`。
- **引用类型的基类是 `System.Object`；值类型的基类是 `System.ValueType`。**

### 1.1.4 托管堆与非托管堆（C# / .NET）

**托管堆（Managed Heap）**

- 由 .NET 运行时（CLR）管理，CLR 负责分配、释放。
- 垃圾回收（GC）：自动检测并回收不再使用的对象，无需显式释放。
- 内存碎片整理：GC 回收时会进行压缩整理。
- 类型安全：CLR 确保只有正确类型能访问对应内存区域，减少类型错误和内存泄漏风险。
- 适用：大多数 C# 对象（类实例、数组、字符串、`new` 出来的对象）。

**非托管堆（Unmanaged Heap）**

- 不由 CLR 管理，需要手动分配与释放（如 `Marshal.AllocHGlobal` / `Marshal.FreeHGlobal`）。
- 手动管理容易导致内存泄漏、悬垂指针。
- 无 GC，无因 GC 引起的性能波动，开销低。
- 适用：与 C/C++ 等非托管代码互操作、对性能延迟敏感的场景。

### 1.1.5 byte 类型

- `byte`：**无符号** 8 位整数，取值 0~255，占用 1 字节。
- 有符号 8 位整数是 `sbyte`，取值 -128~127。

### 1.1.6 C++ 与 C# 的区别

| 对比项 | C++ | C# |
| --- | --- | --- |
| 内存管理 | 手动管理（new/delete），易内存泄漏 | 托管，自动 GC |
| 平台 | 原生编译，跨平台需分别编译 | 编译为 IL，由 CLR/Mono 运行，跨平台 |
| 指针 | 支持任意指针运算 | 支持但不鼓励（unsafe 上下文） |
| 继承 | 支持多继承 | 单继承 + 多接口 |
| 泛型 | 模板，编译期实例化 | 泛型，运行时支持协变/逆变 |
| 头文件 | 声明与实现分离（.h/.cpp） | 无头文件，类内声明即实现 |
| 运行环境 | 直接运行 | 需要 .NET/Mono 运行时 |

## 1.2 字符串

### 1.2.1 String 与 StringBuilder 的区别

**String（不可变）**

- 每次重新赋值或拼接都会**创建新的字符串对象**并分配新内存。
- 天然线程安全（不可变，多线程并发读无问题）。
- 方法返回的是新字符串，不在原字符串上修改。
- 适合：不需要频繁修改的字符串（配置信息、常量、方法参数）。

**StringBuilder（可变）**

- 在原内存上修改，不创建新对象；容量不够时自动扩容。
- 默认**非线程安全**，多线程修改需要手动同步。
- 适合：频繁拼接/修改字符串（动态内容、大量拼接）。

> 编译器并不会把字符串 `+` 优化成 StringBuilder：它只做常量折叠，并调用 `string.Concat` 的重载（操作数较多时用 `Concat(params string[])`，.NET Core 3.0+ 内部会用类似 StringBuilder 的 `ValueStringBuilder` 减少中间对象；两三个操作数仍是直接分配一个新串）。少量拼接直接用 `+` 即可，大量拼接建议显式使用 StringBuilder。

### 1.2.2 经典代码题：产生几个临时对象

```csharp
string a = new string("abc");
a = (a.ToUpper() + "123").Substring(0, 2);
```

第二行共产生 **3 个临时字符串对象**（按执行顺序）：

| 顺序 | 执行 | 产生时机 | 结果 |
| --- | --- | --- | --- |
| 1 | `a.ToUpper()` | 方法返回时 | 新串 `"ABC"` |
| 2 | `"ABC" + "123"` | `string.Concat` 返回时 | 新串 `"ABC123"` |
| 3 | `.Substring(0, 2)` | 方法返回时 | 新串 `"AB"` |

- 字面量 `"abc"`、`"123"` 是编译期**驻留（interned）**常量，不算每次执行的新分配。
- 第一行 `new string("abc")` 有一次堆分配，但结果被 `a` 引用，**不是临时对象**；第二行重新赋值后它才失去引用成为垃圾。
- 旧 `a`、`"ABC"`、`"ABC123"` 执行后立即失去引用成为垃圾，最终只剩 `"AB"` 被引用；频繁执行会增加 GC 压力，应改用 `StringBuilder`。

### 1.2.3 去掉字符串多余空格

- 去掉两端空格：`str.Trim()`。
- 去掉所有空格：`str.Replace(" ", "")` 或正则 `Regex.Replace(str, @"\s+", "")`。
- 将连续多个空格合并为一个：`Regex.Replace(str, @"\s+", " ")`。

## 1.3 集合框架

### 1.3.1 List&lt;T&gt; 与 ArrayList 的区别

| 对比项 | `List<T>` | `ArrayList` |
| --- | --- | --- |
| 泛型 | 泛型类，编译期确定元素类型 | 非泛型，元素以 `object` 存储 |
| 类型安全 | 是 | 否（存入任何类型都被当 object） |
| 装箱拆箱 | 无 | 有（值类型存取时发生，费时） |
| 性能 | 高 | 低 |
| 关系 | `List<T>` 是类，实现 `IList<T>` 等接口 | `ArrayList` 是类，实现 `IList` 接口 |

### 1.3.2 Dictionary 底层原理（C#）

- **设计**：桶（Bucket）数组 + 条目（Entry）数组。
  - 桶数组：存放"哈希码 → 条目索引"的映射，每个桶指向条目链表/冲突链的头部。
  - 条目数组：存放实际的键值对。
- **冲突解决**：链地址法（分离链的变体——条目数组 + next 索引串成冲突链，而非独立的链表节点对象；面试答"链地址法/链表"亦可接受）。
- **查找 O(1)**（最坏 O(n)，当哈希冲突严重、大量条目落入同一桶）：
  1. 调用键的 `GetHashCode()` 生成哈希码；
  2. 计算桶索引；
  3. 找到桶对应的链表头，遍历链表比对键。
- **添加 O(1)**：
  1. 先查找键是否已存在；
  2. 插入条目：优先从空闲链表取未使用的条目，否则在桶头部插入新条目。
- **扩容**：条目数超过阈值时，桶数量扩容到下一个质数，并重新映射所有条目（O(n)）。

### 1.3.3 HashSet、Dictionary、Queue、Stack 的特点与使用时机

| 集合 | 特点 | 使用时机 |
| --- | --- | --- |
| `HashSet<T>` | 无序、元素唯一、无索引；查重/去重 O(1) | 需要快速判断"是否存在"、去重 |
| `Dictionary<K,V>` | 键值对、键唯一；按键查询 O(1) | 需要按键快速取值 |
| `Queue<T>` | FIFO 先进先出 | 任务队列、消息队列、BFS |
| `Stack<T>` | LIFO 后进先出 | 撤销操作、DFS、表达式求值 |

### 1.3.4 遍历容器时增删元素的问题

**题目 1**（面试.txt 第一部分 Q7）：

```csharp
List<int> ls = new List<int>(new int[]{1,2,3,4,5});
foreach(int item in ls)
{
    Console.WriteLine(item * item);
    ls.Remove(item);   // 错误：遍历过程中修改集合
}
```

- 问题：`foreach` 依赖枚举器，遍历期间修改集合会抛出 `InvalidOperationException`（"集合已修改"）。
- 避免：改用 `for` 循环从后往前删除，或先收集再统一删除，或用 `RemoveAll`。

**题目 2**（数据结构复习题 Q2 / Q8）：

```csharp
List<int> list = new List<int>() { 1,2,3,4 };
int nIndex = 0;
foreach(int value in list)
{
    if (nIndex == 1 || nIndex == 2)
        list.RemoveAt(nIndex);   // 遍历中修改集合 → 异常
    nIndex++;
}
```

- 同样违反"遍历期间不得修改集合"的规则；另外 `RemoveAt` 会改变后续元素下标，逻辑也容易出错。
- 推荐写法：`for (int i = list.Count - 1; i >= 0; i--) { if (条件) list.RemoveAt(i); }`。

### 1.3.5 不使用 foreach 遍历 Dictionary

```csharp
Dictionary<int, int> dic = new Dictionary<int, int>();
// 方式一：遍历键集合
foreach (int key in dic.Keys) { int v = dic[key]; }
// 方式二：通过枚举器
var enumerator = dic.GetEnumerator();
while (enumerator.MoveNext())
{
    var kv = enumerator.Current;
    int k = kv.Key; int v = kv.Value;
}
```

## 1.4 委托、事件、Lambda、闭包

### 1.4.1 委托的原理

- 委托是一个**类型**，它定义了方法的签名（返回类型 + 参数列表），本身不包含方法体。
- 创建委托实例实际上是创建了一个**指向某个方法的引用**（可以理解为类型安全的函数指针）。
- 委托本质是一个**类**；通过 `delegate` 关键字声明。
- 作用：把方法当作参数传递，实现回调机制；可封装一个或多个签名相同的方法（多播）。

### 1.4.2 委托与事件的区别

| 对比项 | 委托 | 事件 |
| --- | --- | --- |
| 本质 | 类/类型，可实例化、可赋值 | 基于委托的安全封装，是特殊的成员变量 |
| 触发权限 | 可在类外部直接调用 | 只能在**声明它的类内部**触发 |
| 赋值限制 | 类外可直接 `=` 赋值 | 类外只能用 `+=` / `-=`，不能用 `=` |
| 存储位置 | 可作为临时变量 | 只能作为类的成员 |
| 安全性 | 低（外部可随意覆盖） | 高（对外仅暴露注册/注销） |

```csharp
public Action OnEnter;          // 委托：可被外部赋值、调用
public event Action OnEnterEvent; // 事件：外部只能 += / -=
```

### 1.4.3 Action、Func、匿名函数、Lambda

- `Action`：无返回值的委托；`Action<T>` 带参数。
- `Func<T...>`：有返回值，**泛型参数最后一个类型是返回值类型**（如 `Func<string,string,string>` 表示两个 string 参数、返回 string）。
- 匿名函数：没有名字的函数，配合委托/事件使用（传递委托参数或给委托赋值时）；添加到容器后无法单独移除。
- Lambda：匿名函数的简写（参数类型可省略）。

```csharp
Action<int> a = (value) => { Console.WriteLine("lambda"); };
Func<int> b = () => { return 1; };
Func<string, string, string> concat = (a, b) => a + b;   // C#复习题：Func 用 Lambda 写法
```

### 1.4.4 闭包

- 闭包：内层函数可以引用外层函数的局部变量，**即使外层函数已经结束**；被引用的变量生命周期被延长。
- 注意：闭包捕获的是变量的**最终值**，不是创建时的值。

```csharp
class Test {
    public Action action;
    public Test() {
        int value = 10;                 // 局部变量，本应在函数结束时释放
        action = () => Console.WriteLine(value);  // 被引用后生命周期被延长
        for (int i = 0; i < 10; i++) {
            action += () => Console.WriteLine(i); // 运行后全部打印 10（i 的最终值）
            // 若要打印 0~9：int idx = i; 闭包捕获临时变量 idx
        }
    }
}
```

### 1.4.5 泛型协变与逆变（in / out）

- 只用于修饰**泛型接口**和**泛型委托**中的泛型类型参数。
- `out`（协变）：泛型类型**只能作为返回值**，父类泛型委托可以装载子类（自然变化）。
- `in`（逆变）：泛型类型**只能作为参数**，子类泛型委托可以装载父类（逆常规变化）。
- 遵循里氏替换原则，`out`/`in` 修饰的泛型委托之间可以相互装载。

```csharp
delegate T TextOut<out T>();   // out 修饰：只能作返回值
delegate void TextIn<in T>(T t); // in 修饰：只能作参数
```

### 1.4.6 List 排序

- 系统自带类型：直接 `list.Sort()`。
- 自定义类型排序：① 实现 `IComparable` 接口；② 在 `Sort` 中传入比较委托。

```csharp
class Item { public int ID; }
list.Sort((a, b) => a.ID.CompareTo(b.ID));   // 升序；CompareTo 正确处理相等（0）
// 等价手写：list.Sort((a, b) => a.ID > b.ID ? 1 : (a.ID < b.ID ? -1 : 0));  // 1 排右边，-1 排左边
```

## 1.5 面向对象

### 1.5.1 类与接口的区别

1. 类只能被继承一个（单继承）；接口可以实现多个。
2. 实现接口后，接口中的方法**必须全部实现**；类中只有抽象方法才必须被实现。
3. 接口中不能实现方法体（历史说法；C# 8.0 起接口可有默认实现，面试按经典答法）；类中可以。
4. 接口中不能定义实例字段（变量）；类中可以。

### 1.5.2 抽象类与接口的区别（经典答案）

- 抽象类表示"is-a"关系，可以包含**已实现**的方法、字段、构造函数；子类继承后可以直接复用，不必实现所有方法。
- 接口表示"can-do"能力约定，只能定义方法签名（成员不能有实现体）；实现接口时必须实现其中**所有**成员。
- 类只能继承一个抽象类，但可以实现多个接口。

### 1.5.3 sealed 关键字

- 修饰**类**：该类不能被继承。
- 修饰**方法/属性**：防止派生类重写该方法（仅用于重写的方法，与 override 搭配）。

### 1.5.4 访问修饰符

| 修饰符 | 可见范围 |
| --- | --- |
| `public` | 对所有类公开，无限制 |
| `private` | 仅当前类内部 |
| `protected` | 当前类及其派生类 |
| `internal` | 同一程序集（Assembly）内 |
| `protected internal` | protected + internal（同一程序集内或派生类） |

### 1.5.5 里氏替换、is 与 as

- **里氏替换原则**：用父类容器可以装载子类对象；子类对象可以在任何需要父类对象的地方使用。
- `is`：判断对象是否为指定类型，返回 bool。
- `as`：将对象转换为指定类型，失败返回 `null`（不抛异常）。

```csharp
if (obj is Animal) { Animal a = obj as Animal; }
```

### 1.5.6 重载与覆盖的区别

- **重载（Overload）**：同一类中方法名相同、参数列表不同（与返回值无关），编译期确定调用版本。
- **覆盖/重写（Override）**：派生类用 `override` 重写基类 `virtual` 方法，运行时动态绑定。

### 1.5.7 静态构造函数

- 静态构造函数**不能有访问修饰符**（`public`/`private` 等都会报错），也不能有参数。
- 无论创建多少对象，静态构造函数只执行**一次**。
- 触发时机：首次创建类实例，或首次访问类的静态成员之前（先于任何实例构造函数）。
- 静态构造函数中不能使用 `this` 和 `base`。

## 1.6 反射与特性

### 1.6.1 反射的实现原理

- 反射：程序在**运行时**查看自身或其他程序集的**元数据**（类、方法、字段、特性等）并动态操作的能力。
- 本质：审查元数据并收集关于类型的信息。
- 典型步骤：

```csharp
using System.Reflection;
Assembly asm = Assembly.Load("程序集名");       // 1. 加载程序集
foreach (Type t in asm.GetTypes()) { /* 遍历所有类 */ }
Type type = asm.GetType("命名空间.类名");        // 2. 获取类型
object obj = Activator.CreateInstance(type);    // 3. 创建实例
MethodInfo m = type.GetMethod("方法名");        // 4. 获取方法
m.Invoke(obj, new object[]{ 参数 });            // 5. 调用方法
```

### 1.6.2 特性（Attribute）与 DllImport

- **程序集**：编译器编译得到的中间产物（.dll / .exe），包含代码与元数据。
- **元数据**：描述数据的数据，如程序中的类、函数、变量等声明信息。
- **特性**：允许向程序集添加额外元数据的类；可通过反射获取这些额外信息（如 `[ContextMenu]`、`[MenuItem]`、`[DllImport]`）。
- `[DllImport("Text.dll")]`：引用外部语言的 dll；配合 `public static extern int Add(int a, int b)` 映射外部函数。

### 1.6.3 .NET 与 Mono 的关系

- Mono 是 .NET Framework 的**开源跨平台实现**，基于 C# 和 CLR 的 ECMA 标准。
- .NET 原生主要在 Windows 运行；Mono 使 .NET 程序可跨平台运行于 Linux、Unix、macOS 等（类似 JVM 之于 Java）。
- Unity 早期基于 Mono 运行 C# 脚本；IL2CPP 时代则把 IL 转成 C++ 再编译为机器码（详见 Unity 章节 §6.1.3）。

## 1.7 迭代器、foreach、yield、索引器

### 1.7.1 foreach 的本质与迭代器

- 迭代器模式：顺序访问聚合对象中的元素，而不暴露内部结构。
- `foreach` 的本质：
  1. 获取对象的 `GetEnumerator()`（对象需实现 `IEnumerable` / `IEnumerator`）；
  2. 调用 `MoveNext()`，为 true 时通过 `Current` 取得当前元素；
  3. （注：`foreach` 本身**不会调用 `Reset()`**——首次使用前位置已初始化；多数枚举器的 `Reset()` 会抛 `NotSupportedException`，应避免依赖它。）
- `yield` 是语法糖：编译器会把包含 `yield` 的方法转换为一个**状态机类**，保存局部变量和执行位置，实现暂停/恢复（协程的底层基础）。

### 1.7.2 索引器

- 让对象可以像数组一样用下标访问元素，语法类似属性：`访问修饰符 返回类型 this[参数列表] { get; set; }`。
- 索引参数**不限于 int**：可以是 string、枚举、多个参数（类似多维数组）；同名的 `this[...]` 可按不同参数**重载**。
- 限制：不能是 `static`；参数不能是 `ref`/`out`；可只读（只有 get）或只写（只有 set）。

```csharp
class Person {
    private Person[] friends;
    public Person this[int index] {   // int 索引，封装内部数组
        get => friends[index];
        set => friends[index] = value;
    }
}

class ScoreBoard {
    private Dictionary<string, int> map = new();
    public int this[string name] {    // string 索引（字典式查找）
        get => map.TryGetValue(name, out int v) ? v : 0;
        set => map[name] = value;
    }
}

class Matrix {
    private int[,] data = new int[3, 3];
    public int this[int row, int col] {   // 多参数索引（二维）
        get => data[row, col];
        set => data[row, col] = value;
    }
}
```

- get 返回引用类型时可直接修改元素内部：`board[i].Name = "x";`（拿到的是引用）。
- C# 8.0+ 索引与范围：类型只要有 `Count`/`Length` 和 `this[int]`，就支持 `arr[^1]`（倒数第一个）、`arr[1..3]`（切片；数组、string、List 已内置支持）。

### 1.7.3 扩展方法

- 为**现有非静态类型**添加新方法，无需修改原类型定义。
- 规则：必须写在**静态类**中，且必须是**静态方法**；第一个参数用 `this` 修饰表示被扩展的类型。
- 如果与原类型已有方法同名，调用时仍执行原方法（扩展方法不覆盖）。

```csharp
public static class TransformExtensions {
    public static void DeleteAllChild(this Transform tr) {
        for (int i = tr.childCount - 1; i >= 0; i--)
            Object.Destroy(tr.GetChild(i).gameObject);  // 下一帧删除
        // Object.DestroyImmediate(tr.GetChild(i).gameObject); // 立即删除
    }
}
```

## 1.8 GC 垃圾回收

### 1.8.1 什么是 GC？产生原因？如何避免？

- **GC**：自动内存管理机制，由运行时（CLR）自动执行，开发者无需手动释放内存。
- **产生原因**：内存泄漏（忘记释放不再使用的内存）、悬空引用（对象不再使用但仍被引用，无法回收）。
- **工作原理**：三代标记-清除-压缩。
  - **标记**：遍历所有对象，标记仍在使用（可达）的对象；
  - **清除**：回收未被标记对象的内存；
  - **压缩**：将存活对象移动到连续内存区域，减少内存碎片。
  - 分配空间导致碎片化、使用临时对象、对象用完无引用后变成垃圾，都会触发 GC。
- **避免/优化手段**：
  1. 减少 `new` 创建对象的次数；
  2. 使用**对象池**复用对象，避免频繁创建销毁；
  3. 避免值类型 → 引用类型的装箱；
  4. 非托管资源使用 `IDisposable` 及时释放；
  5. 使用静态成员/公共对象复用；字符串拼接用 StringBuilder。

## 1.9 多线程

### 1.9.1 Thread 基础

```csharp
Thread t = new Thread(方法);   // 默认是前台线程
t.IsBackground = true;         // 设为后台线程：主线程结束时随之结束
Thread.Sleep(毫秒);            // 当前线程休眠
```

- 多线程之间**共享进程内存**，为避免竞争条件使用锁（`lock`）。
- `lock(obj)`：当线程进入时若对象未被锁，则执行代码块并锁住对象，其他线程必须等待。

### 1.9.2 Unity 多线程注意事项（详见 Unity 章节）

- Unity 支持多线程，但**只有主线程可以访问 Unity 的 API**（对象、组件、方法）。
- 新开线程一般用于复杂逻辑运算、网络接收消息等；线程与编辑器同步运行，用后要及时关闭。
- 线程与协程的区别见 Unity 章节 §6.5。

## 1.10 其他语法细节

### 1.10.1 ref / out / in / params

| 关键字 | 含义 |
| --- | --- |
| `ref` | 按引用传递，方法内可修改；**调用前必须初始化** |
| `out` | 按引用传递，方法内**必须赋值**；调用前不必初始化 |
| `in` | 只读引用传递，方法内**不能修改** |
| `params` | 可变数量参数，本质是数组 |

### 1.10.2 预处理指令

- 编译器：将源代码翻译成目标代码；预处理指令在实际编译开始前处理信息。
- `#define` / `#undef` 定义/取消符号；`#if` / `#else` / `#elif` / `#endif` 条件编译；`#warning` / `#error` 输出编译期提示。

### 1.10.3 序列化与 Json

- **序列化**：将对象状态转换为可持久存储或网络传输的形式（文本 JSON/XML 或二进制）。
- **反序列化**：序列化的逆过程。
- Json 数据读写（litJson 插件示例）：`JsonMapper.ToObject<JsonData>(json)` 反序列化（有拆箱操作）；`JsonData.ToJson()` 序列化。

### 1.10.4 枚举、异或、运算符优先级

- 枚举成员的值必须是**整数类型**；未显式赋值时依次递增 1。
- 多选枚举：成员用二进制位占位（`[Flags]`）。
- 异或：相同为 0、不同为 1；任何数和 0 异或等于其本身。
- 运算符优先级：`!` > 算术运算符 > 关系运算符 > `&&` > `||` > 赋值运算符。

### 1.10.5 readonly 与 const

- `readonly`：字段只能在**声明时或构造函数中**初始化，之后不可更改。
- `const`：编译期常量，声明时必须赋值；`const` 字段是隐式静态的。

### 1.10.6 经典输出题：静态字段

```csharp
class MyClass {
    public MyClass() { v1++; v2++; }   // 每 new 一次：v1、v2 各 +1
    public static int v1;              // 静态：所有实例共享
    public int v2;                     // 实例字段
}
MyClass mc1 = new MyClass();           // v1=1, mc1.v2=1
MyClass mc2 = new MyClass();           // v1=2, mc2.v2=1
Console.WriteLine("{0}{1}{2}", MyClass.v1, mc1.v2, mc2.v2);
// 输出：211
```
