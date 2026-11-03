# 创意模式（Creativity Mode）

给 DeepSeek Harness 增加一个**会话级**的「创意程度」开关：需要灵感时切到发散，需要按部就班时切到严谨，
不用每次在提示词里手动写「多给几个大胆的想法」或「只做我让你做的事」。

安装位置：`@local/dsh-creativity-mode`（本目录），已安装到 profile `web` 并处于激活状态。

## 四个档位

| 档位 | 名称 | 模型侧行为 |
| --- | --- | --- |
| `divergent` | 发散 | 先求新求广：给 3–5 个真正不同的方向、质疑前提、至少一个非显而易见的选项；执行类任务仍须遵守用户约束 |
| `balanced` | 平衡 | **默认，什么都不加**：完全保持部署原有提示词，零额外 token |
| `strict` | 严谨 | 最小、精确、可验证：只做被要求的事，不做顺手重构/加功能，先验证再宣布成功 |
| `auto` | 自动 | 阶段策略：开始时按发散走，**第一次调用 `write`/`edit` 时自动翻成严谨**，之后一直保持严谨；再次选择 `auto` 会重新进入发散阶段 |

档位只影响「怎么想」，不改变模型、工具集、权限或沙箱。

### Auto 是怎么判阶段的

它不猜你的意图，只看一个机械事实：**模型有没有开始改文件**。

- 新选 `auto`（或 `/creativity auto`）→ 阶段 `ideate`，提示词用发散；
- 模型第一次调用 `write` 或 `edit` → 阶段 `execute`，下一步起提示词换成严谨；
- 之后保持严谨，直到你手动切回 `divergent`/`auto`/`balanced`。

两个已知边界：

- **第一次改文件本身仍在发散提示词下发生**（提示词在工具调用前就已组装好），自动切换影响的是它之后的步骤；
- 只认 `write`/`edit`；用 `bash` 里 `cat > file` 这类方式写文件不会触发翻转（因为无法区分读和写）。

## 三种切换方式

1. **输入框左侧的档位按钮**：显示当前档位（发散 / 平衡 / 严谨 / 自动），点击**向上弹出选项卡片**，
   选中即生效（样式与「Full access」权限选择器一致：图标 + 名称 + 当前项打勾）。
   `auto` 的悬停提示会显示当前实际阶段（发散/严谨）。
   键盘可用：↑/↓/Home/End 移动，Enter 选择，Esc 关闭并把焦点还给按钮。
2. **斜杠命令**：
   - `/creativity` 或 `/creativity status` — 查看当前档位（auto 会显示当前阶段）
   - `/creativity divergent|balanced|strict|auto` — 直接设置
   - 也接受中文别名：`发散` `创意` `平衡` `默认` `严谨` `严格` `执行` 等
3. **直接说人话**：例如「这几步按部就班来，别自由发挥」/「先给我几个大胆的方案」，
   Agent 会调用 `set_creativity` 工具切换。

设置**从下一个模型步骤开始生效**，并写入会话日志，因此重启、恢复会话（resume）、分叉（fork）都会保留。

## 实现方式

- **Host**（`index.js`）
  - `sessionProjections` 注册 `creativity` 投影：折叠 `command/run` → `command/done` 生命周期
    （`/creativity` 与 `set_creativity` 工具都会产生它），成功后才提交档位，失败自动回退；
    另外折叠 `tool/call`：`auto` 阶段的首次 `write`/`edit` 把阶段从 `ideate` 翻到 `execute`。
    状态只来自会话日志，不引入新事件类型，所以旧会话可正常重开、投影可持久化。
  - `systemPrompt.section('creativity:policy')`：每个模型步骤按当前**有效档位**产出提示词段落
    （`auto` 按阶段映射到发散或严谨，并附上一段说明当前阶段的短注）；
    `balanced` 返回空字符串，请求内容与未安装时逐字节一致。
  - `commands.register('creativity')`：唯一的业务入口（校验 + 结果文案）。
  - `tools.register('set_creativity')`：自然语言入口，内部调用同一个 `/creativity` 命令，
    保证 UI 与工具共用同一套逻辑与日志。
- **Client**（`client.js`）
  - 注册到 `conversation.input.left`（输入框工具行左侧，`id: creativity`，`order: 21`）。
  - 触发按钮与权限选择器同款：图标 + 名称 + 展开箭头；点击用 `position: fixed` 的
    portal 卡片向上弹出（避免被输入框容器裁切），并做视口边缘收敛、滚动/resize 跟随、
    点击外部与 Esc 关闭。
  - 通过 `useProjection('creativity')` 读取 Host 折叠并下发的结果（mode / level / phase），
    选项里给当前档位打勾；选择时调用 `ctx.remote.commands.execute(sessionId, '/creativity <mode>', [])`。
  - 文案走 Client locale（`ctx.locale.register`），样式只用主题 token（`--dsw-alias-*`）。
- **展示元数据**：`locale/en.json`、`locale/zh.json` 提供 Plugin Manager 里的标题与描述；`icon.svg` 为原创图标。

## 更「物理」的创意度（可选增强）

现在的档位改的是**提示词**——便宜、可回滚、不伤正确性。如果还想要"手感"上更明显的创意度，
可以再加一层改**采样参数**的开关。需要先理解三件事：

1. 模型每写一个词，是给候选词算概率再抽样。温度（`temperature`）负责把这些概率"压平"或"拉尖"：
   `0` 永远选最可能的（稳、易重复），`1` 原样抽，`>1` 冷门词更容易被抽中（更意外，也更容易跑题）。
2. 它只改变**表达的发散度**，不改变**想法的质量**。调高温度不会让模型更聪明，只会更不愿意选最顺的那句。
3. 在 DSH 里能改的是 `agent/request` 返回的 `LlmCallConfig`，字段只有
   `temperature`、`reasoningEffort`、`maxTokens`、`stop`（没有 `top_p`、频率惩罚）。

一个按档位配参数的草稿：

```js
ctx.on('agent/request', async ({ agent }, next) => {
  const decision = await next();
  const level = readLevel(agent.session);
  if (level === 'divergent') return { ...decision, temperature: 1.2 };
  if (level === 'strict') return { ...decision, temperature: 0.3 };
  return decision; // balanced：完全跟随部署默认
});
```

落地前必须知道的三个坑：

- 当前走 DeepSeek Messages 适配器，`thinking` 开启时温度可能被忽略或拒绝
  （Anthropic 风格的接口通常要求思考开启时 `temperature = 1`）；适配器是原样透传的，
  失败要捕获并回落到"不设温度"。
- `reasoningEffort` 只支持 `off | low | high | max`；改它会触发新的 request header（`reason: change`）。
- 温度升高对工具调用、代码生成是负收益（参数拼错、路径写错）。更稳的做法是只在发散档、
  且只在纯讨论轮次升高温度。

真想要"多个不一样的想法"，比温度更物理的是**多采样**：同一问题并发跑 N 次再挑/合并
（DSH 里可用 `subagent`/`workflow` 做 3 路），代价是 N 倍 token 与延迟。

## 目录

```
package.json        # dsh.bundle + dsh.client（web）
cordis.patch.yml    # 插入 creativity-mode 行
index.js            # Host：投影 / 提示词 / 命令 / 工具
client.js           # Client：输入框胶囊按钮
locale/en.json      # 显示标题与描述
locale/zh.json
icon.svg
```

## 调整提示词

两个档位的具体指令写在 `index.js` 顶部的 `GUIDANCE` 常量里，改完保存即可（Host 会热重载）。

## 卸载

在插件管理里移除 bundle `@local/dsh-creativity-mode`，或删除 profile 里对应行。
会话日志中已有的 `command/run` 记录会保留，但不再有任何提示词效果。
