# Issue tracker: GitHub

本仓库的规格、缺陷、验证任务和后续功能都使用 GitHub Issues 管理，通过 `gh` CLI 读写。

## 约定

- 每个 Issue 必须描述用户可见结果、验收标准和阻塞关系。
- 可直接实施的 Issue 使用 `ready-for-agent`；需要业务判断或人工验收的 Issue 使用 `ready-for-human`。
- 优先级使用 `priority:P0`、`priority:P1`、`priority:P2`。
- Issue 完成后必须附上实际验证命令、样本范围和结果，不能只写“已测试”。
- Pull Request 不作为外部需求入口。

## 常用操作

- 创建：`gh issue create`
- 查看：`gh issue view <number> --comments`
- 列表：`gh issue list --state open`
- 更新标签：`gh issue edit <number> --add-label <label>`
- 关闭：`gh issue close <number> --comment <verification>`
