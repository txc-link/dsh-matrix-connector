# Progress — 2026-08-31 next batch (connector)

## 状态
- **current phase**: B_pre ✅ → V_proactive (next) → C_slash → EC_light → verify → SSoT/walkthrough 回写
- **last update**: 2026-08-31 step 7

## 步骤
1. ✅ B_pre: 0.5.2 合入 main, 276/276 绿, typecheck clean
2. ⏳ V_proactive: speech.domains 白名单 + 非 companion 域投递 + /agora say
3. ⏳ C_slash: calendar/doc/call verb 注册 + 路由
4. ⏳ EC_light: Element Call widget 状态事件 + /agora call join
5. ⏳ verify + SSoT + walkthrough 回写
6. ⏳ npm pack (0.6.0) → 待用户授权 publish

## 测试/验证记录
- 2026-08-31: 合并后 `npm test` = 276 pass / 0 fail; `npm run typecheck` = clean

## 偏差 / 待决
- (无)