# 创建项目弹窗验证

复用模型设置的独立 renderer 驱动。项目创建、目录选择和项目注册均通过内存 bridge 模拟，不创建真实项目目录，不调用本机文件夹选择器，也不连接用户已经打开的应用。

先静态编译所有生成表达式和 fixture 注入（不会启动软件）：

```powershell
node tests/fixtures/project-creation/scenarios.mjs --check
```

构建后使用专属无界面测试浏览器：

```powershell
node tests/fixtures/model-settings/run.mjs --run --scenario=../project-creation/scenarios.mjs
```

场景覆盖打开弹窗而非直接选择文件夹、两种来源方式、取消零写入、文件夹选择取消保留、失败保留名称、提交期间防重复创建、创建成功只注册和切换一次，以及添加现有文件夹。名称使用真实键盘输入。

截图包含中文深色创建界面、浅色现有目录界面和 420×760 窄屏长路径界面。每个截图前检查弹窗及可见控件位于视口内、没有水平溢出。截图和包含构建哈希、断言、调用记录的报告由公共驱动写入 `out/review/model-settings/runs/`，成功或失败后均只关闭本次启动的测试浏览器。
