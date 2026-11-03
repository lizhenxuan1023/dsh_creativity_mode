# 创意模式（Creativity Mode）

给 DeepSeek Harness 增加一个**会话级**的「工作风格」开关：需要灵感时切到发散，整理资料时切到忠实，
平时用平衡。设置写在对话里，不改系统提示词。

安装位置：`@local/dsh-creativity-mode`（本目录），已安装到 profile `web` 并处于激活状态。

## 三个档位

| 档位 | 名称 | 模型侧行为 |
| --- | --- | --- |
| `divergent` | 发散 | 先求新求广：3–5 个真正不同的方向、质疑前提、至少一个非显而易见的选项；**动手改文件时自动切到编辑纪律**（最小改动、按现有约定、不加戏、先验证） |
| `balanced` | 平衡 | 默认。明确说明「没有额外风格约束，之前的风格指令作废」——切回来不会像没生效 |
| `faithful` | 忠实 | 整理资料不加工：保留原文顺序与措辞，不加结论/评价/总结，不删细节，矛盾标注 `[as written]` 而不是替你修正 |

风格只影响「怎么想/怎么写」，不改变模型、工具集、权限或沙箱。

## 三种切换方式

1. **输入框左侧的档位按钮**：显示当前档位，点击向上弹出选项卡片（与「Full access」权限选择器同款）；
   ↑/↓/Home/End 移动，Enter 选择，Esc 关闭。
2. **斜杠命令**：`/creativity` 查看；`/creativity divergent|balanced|faithful` 设置；
   也接受中文别名：`发散` `创意` `平衡` `默认` `忠实` `照录` 等。
3. **直接说人话**：Agent 会调用 `set_creativity` 工具切换。

切换**从下一个模型步骤开始生效**，并写入会话日志，所以重启、恢复、fork 都会保留。

## 它怎么生效（以及为什么不改系统提示词）

- 系统提示词里只放一段**永不变化**的锚：当前风格以对话中最近一条 `creativity-mode` notice 为准，
  新的覆盖旧的。
- 每次切换，注入一条很短的 user notice（balanced ≈ 50 token，divergent/faithful ≈ 250 token）。
- 这样切换**不会**产生系统提示词副本。这一点很关键：`deepseek-flash` 声明了
  `systemPromptUpdate: in-history`，每次系统提示词变化都会**追加一整份**（约 1.7k token），
  旧版本还会留在历史里；频繁切换会把上下文撑大。notice 方式把每次切换的成本降到几十分之一。
- 压缩（compaction）可能把 notice 折进摘要，所以 `compaction/end` 之后、以及恢复会话时，
  会对非 balanced 档补注一条。

已知边界：

- notice 是一条 user 消息，但 UI 用主机的 context 折叠行渲染：标签 `style` + 摘要 `Divergent/Balanced/Faithful`，
  默认收起，展开才看到完整规则。
- 它属于用户级指令，压不住系统级规则；对风格控制够用。
- 旧版本留在历史里的系统提示词副本不会因为本插件而消失（那是模型能力决定的，只能靠压缩或新会话清理）。

## 实现

- **Host**（`index.js`）
  - `sessionProjections` 注册 `creativity` 投影：折叠 `command/run` → `command/done`，成功后才提交。
  - `systemPrompt.section('creativity:anchor')`：order 9500，位于所有工具段之后，文本恒定。
  - `commands.register('creativity')`：唯一的业务入口；切换时 `agent.inject` 注入 notice。
  - `tools.register('set_creativity')`：自然语言入口，内部调用同一个命令。
  - `session/event` 监听 `compaction/end`、`agent/created`：为非 balanced 档补注 notice。
- **Client**（`client.js`）
  - 注册到 `conversation.input.left`（`id: creativity`，`order: 23`），读取投影里的 `mode`。
  - 点击调用 `ctx.remote.commands.execute(sessionId, '/creativity <mode>', [])`。
  - 文案走 Client locale，样式只用主题 token。

## 目录

```
package.json        # dsh.bundle + dsh.client（web）
cordis.patch.yml    # 插入 creativity-mode 行
index.js            # Host：投影 / 锚 / notice / 命令 / 工具
client.js           # Client：输入框档位按钮
locale/en.json      # Plugin Manager 显示标题与描述
locale/zh.json
icon.svg
ROADMAP.md          # 只记录用户原话的待办
```

## 卸载

在插件管理里移除 bundle `@local/dsh-creativity-mode`，或删除 profile 里的对应行。
已注入的 notice 会留在会话历史里，但不再有任何效果。
