// A small, dependency-free learning platform API and static file server.
// Data is written atomically to data/platform.json on each change.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { streamZip } = require('./zip-stream');
const storage = require('./storage');
const SCHEDULING_ENGINE_FULL = "// Zero-dependency intelligent course scheduling engine (51-style constraints, greedy + backtracking solver, conflict & substitute finder).\nconst crypto = require('node:crypto');\n\nconst id = prefix => `${prefix}_${crypto.randomUUID()}`;\nconst now = () => new Date().toISOString();\n\n// ============================================================\n// Scheduling rule keywords: every checklist item becomes a\n// stable, switchable rule with optional parameters.\n// ============================================================\nconst RULE_CATEGORY_LABELS = Object.freeze({\n  time: '时间类冲突', resource: '资源类冲突', rule: '教学规则与需求', special: '特殊安排', check: '检查清单',\n});\n\nconst RULE_CATALOG = Object.freeze([\n  { key: 'TEACHER_NO_OVERLAP', code: 'H01', name: '同一教师同时多班课', category: 'time', severity: 'hard', enabled: true, params: {}, hint: '一位教师同一时间段不能出现在两个班级' },\n  { key: 'CLASS_NO_OVERLAP', code: 'H02', name: '同一班级同时多课', category: 'time', severity: 'hard', enabled: true, params: {}, hint: '一个班同一时间只能上一门课' },\n  { key: 'PERIOD_NO_OVERLAP', code: 'H07', name: '时段重复或重叠', category: 'time', severity: 'hard', enabled: true, params: {}, hint: '09:00–10:00 与 09:30–10:30 视为重叠' },\n  { key: 'VALID_TEACHING_PERIOD', code: 'H03', name: '合法教学时段', category: 'time', severity: 'hard', enabled: true, params: {}, hint: '不排到早读/午休/课间等非上课节次' },\n  { key: 'FIXED_SLOT_LOCK', code: 'H06', name: '固定时段锁定', category: 'time', severity: 'hard', enabled: true, params: { labels: '早读,午休,放学,课间操,升旗' }, hint: '升旗、课间操、集会等全校固定时段不可排课' },\n  { key: 'DOUBLE_PERIOD_CONTIGUOUS', code: 'H12', name: '连堂课不被打断', category: 'time', severity: 'hard', enabled: true, params: { requiredConsecutive: 2 }, hint: '标记连堂/实践课后必须排在连续教学节，中间不插课' },\n  { key: 'TEACHER_DAILY_LIMIT', code: 'M03', name: '教师每日课时上限', category: 'time', severity: 'warning', enabled: true, params: { defaultMax: 6 }, hint: '教师一天最多 N 节，超限时提示' },\n  { key: 'SUBJECT_DAILY_LIMIT', code: 'M05', name: '单科一天上限', category: 'time', severity: 'warning', enabled: true, params: { maxPerDay: 2 }, hint: '同一班同一科目一天不超过 N 节' },\n  { key: 'TRAVEL_BUFFER', code: 'M12', name: '跨年级赶路缓冲', category: 'time', severity: 'warning', enabled: true, params: { minGapMinutes: 10 }, hint: '教师跨年级/跨校区相邻两课之间预留赶路时间' },\n  { key: 'ROOM_NO_OVERLAP', code: 'H05', name: '教室场地占用', category: 'resource', severity: 'hard', enabled: true, params: {}, hint: '同一教室同一时间只能被一个班级占用' },\n  { key: 'EQUIPMENT_NO_OVERLAP', code: 'H13', name: '设备器材冲突', category: 'resource', severity: 'hard', enabled: true, params: {}, hint: '共用同一设备/器材的教室不能同时上课' },\n  { key: 'ROOM_TYPE_MATCH', code: 'H08', name: '专用教室类型匹配', category: 'resource', severity: 'hard', enabled: true, params: {}, hint: '实验室、电脑室、音乐室按科目需求匹配' },\n  { key: 'ROOM_CAPACITY', code: 'M11', name: '教室容量足够', category: 'resource', severity: 'hard', enabled: true, params: {}, hint: '教室容量不能小于班级人数' },\n  { key: 'CLASS_WEEKLY_LIMIT', code: 'M07', name: '班级周课时上限', category: 'resource', severity: 'warning', enabled: true, params: {}, hint: '班级一周总节数不超过设定上限' },\n  { key: 'GRADE_WEEKLY_LIMIT', code: 'M13', name: '年级周课时总量合规', category: 'resource', severity: 'warning', enabled: true, params: { defaultMax: 40 }, hint: '按小学/初中/高中课标控制年级周总课时' },\n  { key: 'PLAN_HOURS_MATCH', code: 'M08', name: '单科周节数符合计划', category: 'rule', severity: 'warning', enabled: true, params: {}, hint: '数学计划 5 节就不能排 6 节或 3 节' },\n  { key: 'MAIN_SUBJECT_MORNING', code: 'M09', name: '主科上午优先', category: 'rule', severity: 'warning', enabled: true, params: { minMorningRatio: 0.5, subjects: '语文,数学,英语,物理,化学' }, hint: '主科尽量排在上午精力好的时段' },\n  { key: 'SUBJECT_BALANCE', code: 'M14', name: '文理动静搭配', category: 'rule', severity: 'warning', enabled: true, params: { maxSameCategoryPerDay: 3 }, hint: '技能科不集中同一天，文理/动静交叉安排' },\n  { key: 'TEACHER_FIXED_BLOCK', code: 'H06B', name: '教师固定不可排', category: 'rule', severity: 'hard', enabled: true, params: {}, hint: '教研、会议、培训、请假时段不排课' },\n  { key: 'TEACHER_PREFERENCE', code: 'SOFT', name: '教师偏好与禁忌', category: 'rule', severity: 'soft', enabled: true, params: {}, hint: '不排早自习、不排最后一节等偏好' },\n  { key: 'AVOID_LAST_PERIOD', code: 'SOFT2', name: '避开最后一节', category: 'rule', severity: 'soft', enabled: true, params: {}, hint: '科目设置 avoidLastPeriod 时避开末节' },\n  { key: 'COMBINED_CLASS_COORDINATE', code: 'H14', name: '合班课公开课协调', category: 'special', severity: 'hard', enabled: true, params: {}, hint: '合班涉及多个班级时，原各班课程要协调' },\n  { key: 'CROSS_GRADE_AUTH', code: 'M10', name: '教师跨年级授权', category: 'special', severity: 'warning', enabled: true, params: {}, hint: '既教初一又教初二，两个年级不能撞且需授权' },\n  { key: 'FIXED_ACTIVITY_DAY', code: 'H15', name: '固定活动日', category: 'special', severity: 'hard', enabled: true, params: { keywords: '班会,社团,大扫除,运动会,调课' }, hint: '班会、社团、大扫除、运动会等固定活动日不排课' },\n  { key: 'RESERVE_SLACK', code: 'M15', name: '预留机动课时', category: 'special', severity: 'warning', enabled: true, params: { minFreeSlots: 2 }, hint: '每班每周预留 1–2 节机动时间便于调课补课' },\n  { key: 'THREE_TABLE_AUDIT', code: 'C01', name: '三表对照自查', category: 'check', severity: 'info', enabled: true, params: {}, hint: '按教师/班级/教室三张表交叉核对' },\n  { key: 'PRIORITY_ORDER', code: 'C02', name: '先锁固定项再排专用连堂', category: 'check', severity: 'info', enabled: true, params: {}, hint: '智能排课按固定项→专用教室→连堂→普通课顺序' },\n]);\n\nconst RULE_BY_KEY = Object.fromEntries(RULE_CATALOG.map(r => [r.key, r]));\nconst RULE_BY_CODE = Object.fromEntries(RULE_CATALOG.map(r => [r.code, r]));\n\nfunction defaultRuleConfig() {\n  const out = {};\n  for (const rule of RULE_CATALOG) out[rule.key] = { enabled: rule.enabled !== false, params: { ...(rule.params || {}) } };\n  return out;\n}\nfunction normalizeRuleConfig(input) {\n  const cfg = defaultRuleConfig();\n  if (!input || typeof input !== 'object') return cfg;\n  for (const rule of RULE_CATALOG) {\n    const item = input[rule.key];\n    if (!item) continue;\n    if (typeof item === 'boolean') cfg[rule.key].enabled = item;\n    else {\n      if (item.enabled !== undefined) cfg[rule.key].enabled = Boolean(item.enabled);\n      if (item.params && typeof item.params === 'object') {\n        for (const [k, v] of Object.entries(item.params)) {\n          if (k in cfg[rule.key].params) cfg[rule.key].params[k] = typeof cfg[rule.key].params[k] === 'number' ? Number(v) : String(v);\n        }\n      }\n    }\n  }\n  return cfg;\n}\nfunction getRuleConfig(scope) {\n  return normalizeRuleConfig(scope?.ruleConfig);\n}\nfunction isRuleOn(scope, key) {\n  const rule = RULE_BY_KEY[key];\n  if (!rule) return true;\n  const cfg = scope?.ruleConfig?.[key];\n  return cfg ? cfg.enabled !== false : rule.enabled !== false;\n}\nfunction ruleParam(scope, key, name, fallback) {\n  const v = scope?.ruleConfig?.[key]?.params?.[name];\n  return v === undefined || v === '' ? fallback : v;\n}\nfunction listRules() {\n  return { rules: RULE_CATALOG, categories: RULE_CATEGORY_LABELS, defaults: defaultRuleConfig() };\n}\nfunction tagIssues(scope, issues) {\n  const out = [];\n  for (const raw of issues || []) {\n    const issue = { ...raw, hard: [], warnings: [] };\n    for (const bucket of ['hard', 'warnings']) {\n      for (const item of (raw[bucket] || [])) {\n        const rule = RULE_BY_CODE[item.code] || (item.code === 'SOFT' ? RULE_BY_KEY.TEACHER_PREFERENCE : null);\n        if (rule && !isRuleOn(scope, rule.key)) continue;\n        issue[bucket].push(rule ? { ...item, rule: rule.key, ruleName: rule.name, ruleCategory: rule.category } : item);\n      }\n    }\n    if (issue.hard.length || issue.warnings.length) out.push(issue);\n  }\n  return out;\n}\n\nfunction defaultPeriods() {\n  return [\n    { id: 'p1', index: 1, name: '第1节', startTime: '08:00', endTime: '08:45', isBreak: false, breakLabel: '' },\n    { id: 'p2', index: 2, name: '第2节', startTime: '08:55', endTime: '09:40', isBreak: false, breakLabel: '' },\n    { id: 'b1', index: 2.5, name: '大课间', startTime: '09:40', endTime: '10:10', isBreak: true, breakLabel: '不上课' },\n    { id: 'p3', index: 3, name: '第3节', startTime: '10:10', endTime: '10:55', isBreak: false, breakLabel: '' },\n    { id: 'p4', index: 4, name: '第4节', startTime: '11:05', endTime: '11:50', isBreak: false, breakLabel: '' },\n    { id: 'b2', index: 4.5, name: '午休', startTime: '11:50', endTime: '14:00', isBreak: true, breakLabel: '不上课' },\n    { id: 'p5', index: 5, name: '第5节', startTime: '14:00', endTime: '14:45', isBreak: false, breakLabel: '' },\n    { id: 'p6', index: 6, name: '第6节', startTime: '14:55', endTime: '15:40', isBreak: false, breakLabel: '' },\n    { id: 'b3', index: 6.5, name: '课外活动', startTime: '15:40', endTime: '16:30', isBreak: true, breakLabel: '可选排兴趣课' },\n  ];\n}\n\nfunction emptyScope() {\n  return {\n    settings: {\n      schoolLevel: '高中',\n      campusName: '主校区',\n      daysPerWeek: 5,\n      periods: defaultPeriods(),\n      blockedSlots: [], // [{ key: '1-p1', reason: '升旗仪式' }]\n    },\n    grades: [],\n    classes: [],\n    subjects: [],\n    rooms: [],\n    teacherRules: {},\n    ruleConfig: defaultRuleConfig(),\n    plans: [], // [{ id, classId, subjectId, teacherId, roomId, weeklyHours, fixed }]\n    entries: [], // [{ id, planId, classId, subjectId, teacherId, roomId, day, periodId, locked, temporary, overrideReason, updatedAt }]\n    published: null, // { publishedAt, publishedBy, settings, grades, classes, subjects, rooms, entries }\n    swapRequests: [],\n    auditLogs: [],\n    archives: [],\n    combinedGroups: [],\n    placement: { students: [], config: { classCount: 4, classPrefix: '新生', mode: 'total', genderBalance: true }, result: null },\n    exams: [],\n    teacherGroups: [],\n    groupBlocks: [],\n  };\n}\n\nfunction ensureScope(db, scopeKey) {\n  if (!db.scheduling || typeof db.scheduling !== 'object') db.scheduling = {};\n  if (!db.scheduling[scopeKey]) db.scheduling[scopeKey] = emptyScope();\n  const s = db.scheduling[scopeKey];\n  if (!s.settings) s.settings = emptyScope().settings;\n  if (!Array.isArray(s.settings.periods) || !s.settings.periods.length) s.settings.periods = defaultPeriods();\n  if (!Array.isArray(s.settings.blockedSlots)) s.settings.blockedSlots = [];\n  if (!s.placement || typeof s.placement !== 'object') s.placement = { students: [], config: { classCount: 4, classPrefix: '新生', mode: 'total', genderBalance: true }, result: null };\n  if (!Array.isArray(s.placement.students)) s.placement.students = [];\n  for (const k of ['grades', 'classes', 'subjects', 'rooms', 'plans', 'entries', 'swapRequests', 'auditLogs', 'archives', 'combinedGroups', 'exams', 'teacherGroups', 'groupBlocks']) {\n    if (!Array.isArray(s[k])) s[k] = [];\n  }\n  if (!s.teacherRules || typeof s.teacherRules !== 'object') s.teacherRules = {};\n  s.ruleConfig = normalizeRuleConfig(s.ruleConfig);\n  return s;\n}\n\nfunction slotKey(day, periodId) {\n  return `${day}-${periodId}`;\n}\n\nfunction teachingPeriods(scope) {\n  return (scope.settings?.periods || []).filter(p => !p.isBreak);\n}\n\nfunction isMorningPeriod(scope, periodId) {\n  const list = teachingPeriods(scope);\n  const idx = list.findIndex(p => p.id === periodId);\n  return idx >= 0 && idx < Math.ceil(list.length / 2);\n}\n\nfunction isLastPeriod(scope, periodId) {\n  const list = teachingPeriods(scope);\n  return list.length > 0 && list[list.length - 1].id === periodId;\n}\n\nfunction isFirstPeriod(scope, periodId) {\n  const list = teachingPeriods(scope);\n  return list.length > 0 && list[0].id === periodId;\n}\n\n// Validates a candidate entry against H01-H06 (hard) and M01-M06 / soft rules.\nfunction timeToMinutes(value) {\n  const match = String(value || '').match(/^(\\d{1,2}):(\\d{2})$/);\n  return match ? Number(match[1]) * 60 + Number(match[2]) : null;\n}\nfunction periodsOverlap(scope, periodA, periodB) {\n  if (!periodA || !periodB || periodA.isBreak || periodB.isBreak) return false;\n  const a1 = timeToMinutes(periodA.startTime), a2 = timeToMinutes(periodA.endTime);\n  const b1 = timeToMinutes(periodB.startTime), b2 = timeToMinutes(periodB.endTime);\n  if ([a1, a2, b1, b2].some(v => v == null)) return false;\n  return a1 < b2 && b1 < a2;\n}\nfunction checkPlacement(scope, candidate, ignoreEntryIds = new Set()) {\n  const hard = [];\n  const warnings = [];\n  const days = Number(scope.settings?.daysPerWeek || 5);\n  const day = Number(candidate.day);\n  const period = (scope.settings?.periods || []).find(p => p.id === candidate.periodId);\n\n  // H03: Valid teaching period & day\n  if (!Number.isInteger(day) || day < 1 || day > days || !period || period.isBreak) {\n    hard.push({ code: 'H03', message: '所选节次为非上课时段或超出每周上课天数' });\n  }\n\n  const key = slotKey(day, candidate.periodId);\n  const globalBlocked = (scope.settings?.blockedSlots || []).find(b => b.key === key);\n  if (globalBlocked) {\n    hard.push({ code: 'H06', message: `该时段已全校锁定（${globalBlocked.reason || '特殊时段'}），不可排课` });\n  }\n\n  const cls = scope.classes.find(c => c.id === candidate.classId);\n  const subj = scope.subjects.find(s => s.id === candidate.subjectId);\n  const tr = scope.teacherRules[candidate.teacherId] || {};\n  const room = candidate.roomId ? scope.rooms.find(r => r.id === candidate.roomId) : null;\n\n  // H08: Specialist room type must match the subject requirement.\n  if (room && subj?.roomType && room.type && subj.roomType !== 'normal' && subj.roomType !== 'any' && subj.roomType !== room.type) {\n    hard.push({ code: 'H08', message: `场地类型冲突：${subj.name} 需要 ${subj.roomType} 类型教室，所选为 ${room.type}` });\n  }\n\n  // H06: Class, teacher, room blocked slots\n  if (cls && Array.isArray(cls.blockedSlots) && cls.blockedSlots.includes(key)) {\n    hard.push({ code: 'H06', message: `${cls.name} 在该时段设置了不可排课` });\n  }\n  if (Array.isArray(tr.blockedSlots) && tr.blockedSlots.includes(key)) {\n    hard.push({ code: 'H06B', message: '该教师在该时段设置了固定不可排时间' });\n  }\n  for (const gb of (scope.groupBlocks || [])) {\n    if (gb.active === false) continue;\n    if (Number(gb.day) !== day || !Array.isArray(gb.periodIds) || !gb.periodIds.includes(candidate.periodId)) continue;\n    const grp = (scope.teacherGroups || []).find(g => g.id === gb.groupId);\n    if (grp && Array.isArray(grp.teacherIds) && grp.teacherIds.includes(candidate.teacherId)) {\n      hard.push({ code: 'H06B', message: `与「${grp.name}」${gb.label || gb.activityType || '教研活动'}时间冲突` });\n    }\n  }\n  if (Array.isArray(tr.availableSlots) && tr.availableSlots.length && !tr.availableSlots.includes(key)) {\n    hard.push({ code: 'H06B', message: '该时段不在教师设定的固定可排时间内' });\n  }\n  if (room && Array.isArray(room.blockedSlots) && room.blockedSlots.includes(key)) {\n    hard.push({ code: 'H06', message: `教室 ${room.name} 在该时段不可用` });\n  }\n\n  // H01, H02, H05: Uniqueness in entries\n  for (const e of scope.entries) {\n    if (ignoreEntryIds.has(e.id)) continue;\n    if (candidate.groupId && e.groupId === candidate.groupId) continue;\n    if (Number(e.day) === day && e.periodId !== candidate.periodId) {\n      const otherPeriod = (scope.settings?.periods || []).find(p => p.id === e.periodId);\n      if (periodsOverlap(scope, period, otherPeriod)) {\n        if (e.teacherId === candidate.teacherId) hard.push({ code: 'H07', message: '时段重叠：该教师在同一时间段已有其他课程' });\n        else if (e.classId === candidate.classId) hard.push({ code: 'H07', message: '时段重叠：该班级在同一时间段已有其他课程' });\n        else if (candidate.roomId && e.roomId === candidate.roomId) hard.push({ code: 'H07', message: '时段重叠：该教室在同一时间段已被占用' });\n      }\n    }\n    if (Number(e.day) !== day || e.periodId !== candidate.periodId) continue;\n    if (e.teacherId === candidate.teacherId) {\n      const otherCls = scope.classes.find(c => c.id === e.classId)?.name || '其他班级';\n      hard.push({ code: 'H01', message: `教师冲突：该教师周${day}此节次已在 ${otherCls} 排课` });\n    }\n    if (e.classId === candidate.classId) {\n      const otherSubj = scope.subjects.find(s => s.id === e.subjectId)?.name || '其他科目';\n      hard.push({ code: 'H02', message: `班级冲突：${cls?.name || '该班级'} 周${day}此节次已安排 ${otherSubj}` });\n    }\n    if (candidate.roomId && e.roomId === candidate.roomId) {\n      hard.push({ code: 'H05', message: `场地冲突：教室 ${room?.name || ''} 该时段已被占用` });\n    }\n  }\n\n  // H04: Teacher-Class-Subject plan check (if plans exist)\n  if (scope.plans.length && candidate.planId !== 'custom') {\n    const matchedPlan = scope.plans.find(p => p.classId === candidate.classId && p.subjectId === candidate.subjectId && p.teacherId === candidate.teacherId);\n    if (!matchedPlan) {\n      hard.push({ code: 'H04', message: '教师-班级-科目未在授课计划中匹配' });\n    }\n  }\n\n  // M03: Teacher daily max periods\n  const maxDaily = Number(tr.maxDailyPeriods || 0);\n  if (maxDaily > 0) {\n    const dayCount = scope.entries.filter(e => !ignoreEntryIds.has(e.id) && Number(e.day) === day && e.teacherId === candidate.teacherId).length;\n    if (dayCount >= maxDaily) {\n      warnings.push({ code: 'M03', message: `该教师周${day}已排满 ${dayCount} 节课（上限 ${maxDaily} 节）` });\n    }\n  }\n\n  // M05: Same subject max 2 periods per day for a class\n  const subjDayCount = scope.entries.filter(e => !ignoreEntryIds.has(e.id) && Number(e.day) === day && e.classId === candidate.classId && e.subjectId === candidate.subjectId).length;\n  if (subjDayCount >= 2) {\n    warnings.push({ code: 'M05', message: `${cls?.name || '该班级'} 周${day}的 ${subj?.name || '该科目'} 已达 ${subjDayCount} 节` });\n  }\n\n  // M07: Class weekly period cap.\n  const maxWeekly = Number(cls?.maxWeeklyPeriods || 0);\n  if (maxWeekly > 0) {\n    const weekCount = scope.entries.filter(e => !ignoreEntryIds.has(e.id) && e.classId === candidate.classId).length;\n    if (weekCount >= maxWeekly) warnings.push({ code: 'M07', message: `${cls.name} 本周已排 ${weekCount} 节，达到上限 ${maxWeekly} 节` });\n  }\n\n  // Soft preference checks\n  if (subj?.avoidLastPeriod && isLastPeriod(scope, candidate.periodId)) {\n    warnings.push({ code: 'SOFT2', message: `${subj.name} 建议避开最后一节` });\n  }\n  if (subj?.preference === 'morning' && !isMorningPeriod(scope, candidate.periodId)) {\n    warnings.push({ code: 'SOFT', message: `${subj.name} 建议优先安排在上午时段` });\n  }\n  if (subj?.preference === 'afternoon' && isMorningPeriod(scope, candidate.periodId)) {\n    warnings.push({ code: 'SOFT', message: `${subj.name} 建议优先安排在下午时段` });\n  }\n\n  const filtered = tagIssues(scope, [{ hard, warnings }])[0] || { hard: [], warnings: [] };\n  return { valid: filtered.hard.length === 0, hard: filtered.hard, warnings: filtered.warnings };\n}\n\nfunction detectGlobalIssues(scope) {\n  const issues = [];\n  const push = (code, message, meta = {}) => issues.push({ entryId: null, ...meta, hard: [], warnings: [{ code, message }] });\n\n  // M08: Actual scheduled periods must match each teaching plan's weekly hours.\n  for (const plan of (scope.plans || [])) {\n    const actual = (scope.entries || []).filter(e => e.planId === plan.id || (e.classId === plan.classId && e.subjectId === plan.subjectId && e.teacherId === plan.teacherId)).length;\n    const expected = Number(plan.weeklyHours || 0);\n    if (expected > 0 && actual !== expected) {\n      const subj = scope.subjects.find(x => x.id === plan.subjectId)?.name || '科目';\n      const cls = scope.classes.find(x => x.id === plan.classId)?.name || '班级';\n      push('M08', `${cls} · ${subj} 计划 ${expected} 节/周，实际已排 ${actual} 节`, { planId: plan.id });\n    }\n  }\n\n  // M09: Main subjects should mostly appear in high-energy morning periods.\n  for (const cls of (scope.classes || [])) {\n    const list = (scope.entries || []).filter(e => e.classId === cls.id && ['语文', '数学', '英语', '物理', '化学'].includes(scope.subjects.find(s => s.id === e.subjectId)?.name || ''));\n    if (!list.length) continue;\n    const morning = list.filter(e => isMorningPeriod(scope, e.periodId)).length;\n    if (morning / list.length < 0.5) push('M09', `${cls.name} 的主科上午占比偏低（${morning}/${list.length}），建议调整到精力较好的时段`, { classId: cls.id });\n  }\n\n  // M10: Teacher grade scope and cross-grade authorization.\n  const gradeMap = scope.teacherGradeMap || {};\n  for (const plan of (scope.plans || [])) {\n    const info = gradeMap[plan.teacherId];\n    const cls = scope.classes.find(c => c.id === plan.classId);\n    const gradeName = cls ? (scope.grades.find(g => g.id === cls.gradeId)?.name || cls.gradeId || '') : '';\n    if (!info || !gradeName || !info.grade) continue;\n    if (gradeName !== info.grade && !(info.crossGrades || []).includes(gradeName)) {\n      const teacherName = info.name || plan.teacherId;\n      push('M10', `跨年级风险：${teacherName} 登记年级为 ${info.grade}，未授权教授 ${gradeName}，排课已按跨年级处理`, { planId: plan.id, teacherId: plan.teacherId });\n    }\n  }\n\n  // M11: Room capacity cannot be smaller than the class size.\n  for (const e of (scope.entries || [])) {\n    const room = scope.rooms.find(r => r.id === e.roomId);\n    const cls = scope.classes.find(c => c.id === e.classId);\n    if (!room || !cls) continue;\n    if (Number(cls.studentCount || (cls.studentIds || []).length) > Number(room.capacity || 0)) {\n      push('M11', `教室容量不足：${room.name} 容量 ${room.capacity}，${cls.name} 有 ${cls.studentCount || (cls.studentIds || []).length} 人`, { entryId: e.id, day: e.day, periodId: e.periodId });\n    }\n  }\n  return issues;\n}\n\nfunction detectRuleKeywordIssues(scope) {\n  const issues = [];\n  const push = (code, message, meta = {}) => issues.push({ entryId: null, ...meta, hard: [], warnings: [{ code, message }] });\n  const days = Number(scope.settings?.daysPerWeek || 5);\n  const periods = (scope.settings?.periods || []).filter(p => !p.isBreak);\n  const subjectName = id => scope.subjects.find(s => s.id === id)?.name || '';\n  const className = id => scope.classes.find(c => c.id === id)?.name || id;\n\n  // FIXED_SLOT_LOCK: break periods whose label matches configured fixed activities.\n  if (isRuleOn(scope, 'FIXED_SLOT_LOCK')) {\n    const labels = String(ruleParam(scope, 'FIXED_SLOT_LOCK', 'labels', '早读,午休,放学,课间操,升旗')).split(/[,，]/).map(x => x.trim()).filter(Boolean);\n    for (const p of (scope.settings?.periods || [])) {\n      if (labels.some(label => String(p.name || '').includes(label) || String(p.breakLabel || '').includes(label))) {\n        push('H06', `固定时段「${p.name || p.breakLabel}」已锁定，不能排课`, { periodId: p.id });\n      }\n    }\n  }\n\n  // FIXED_ACTIVITY_DAY: class-level fixed activity days.\n  if (isRuleOn(scope, 'FIXED_ACTIVITY_DAY')) {\n    const keywords = String(ruleParam(scope, 'FIXED_ACTIVITY_DAY', 'keywords', '班会,社团,大扫除,运动会,调课')).split(/[,，]/).map(x => x.trim()).filter(Boolean);\n    for (const cls of (scope.classes || [])) {\n      for (const act of (cls.fixedActivities || [])) {\n        const label = typeof act === 'string' ? act : (act.label || act.name || '');\n        if (keywords.some(k => label.includes(k))) {\n          push('H15', `${cls.name} 固定活动「${label}」需避开，请检查对应时段`, { classId: cls.id });\n        }\n      }\n    }\n  }\n\n  // EQUIPMENT_NO_OVERLAP: two rooms sharing equipment used at the same slot.\n  if (isRuleOn(scope, 'EQUIPMENT_NO_OVERLAP')) {\n    const roomById = Object.fromEntries((scope.rooms || []).map(r => [r.id, r]));\n    const slotMap = new Map();\n    for (const e of (scope.entries || [])) {\n      const room = roomById[e.roomId];\n      if (!room) continue;\n      const equipment = Array.isArray(room.equipment) ? room.equipment : (room.equipment ? String(room.equipment).split(/[,，]/).map(x => x.trim()) : []);\n      if (!equipment.length) continue;\n      for (const item of equipment) {\n        const slot = slotKey(e.day, e.periodId);\n        const mapKey = item + '|' + slot;\n        (slotMap.get(mapKey) || slotMap.set(mapKey, []).get(mapKey)).push({ e, room });\n      }\n    }\n    for (const [key, list] of slotMap) {\n      if (list.length < 2) continue;\n      const [equipment, slot] = key.split('|');\n      const classes = [...new Set(list.map(x => x.e.classId))];\n      if (classes.length < 2) continue;\n      push('H13', `设备冲突：${equipment} 在 ${slot} 被 ${classes.map(className).join('、')} 同时占用`, { classId: classes[0] });\n    }\n  }\n\n  // DOUBLE_PERIOD_CONTIGUOUS: flagged double lessons must stay in adjacent teaching periods.\n  if (isRuleOn(scope, 'DOUBLE_PERIOD_CONTIGUOUS')) {\n    const required = Math.max(2, Number(ruleParam(scope, 'DOUBLE_PERIOD_CONTIGUOUS', 'requiredConsecutive', 2)));\n    const groups = new Map();\n    for (const e of (scope.entries || [])) {\n      if (!e.needsDouble && !e.doublePeriod) continue;\n      const k = [e.classId, e.subjectId, e.day].join('|');\n      (groups.get(k) || groups.set(k, []).get(k)).push(e);\n    }\n    for (const [k, list] of groups) {\n      if (list.length % required !== 0) {\n        push('H12', `连堂课被打断：${className(list[0].classId)} 周${list[0].day} 的 ${subjectName(list[0].subjectId)} 需要 ${required} 节连续教学节，目前为 ${list.length} 节`, { entryId: list[0].id, classId: list[0].classId, day: list[0].day });\n        continue;\n      }\n      const idx = list.map(e => periods.findIndex(p => p.id === e.periodId)).sort((a, b) => a - b);\n      for (let i = 0; i < idx.length; i += required) {\n        for (let j = 1; j < required; j++) {\n          if (idx[i + j] !== idx[i] + j) {\n            push('H12', `连堂课被打断：${className(list[0].classId)} 周${list[0].day} 的 ${subjectName(list[0].subjectId)} 中间插入了其它课程`, { entryId: list[i].id, classId: list[0].classId, day: list[0].day });\n            j = required;\n          }\n        }\n      }\n    }\n  }\n\n  // COMBINED_CLASS_COORDINATE: classes in a combined group cannot have extra lessons at that slot.\n  if (isRuleOn(scope, 'COMBINED_CLASS_COORDINATE')) {\n    for (const grp of (scope.combinedGroups || [])) {\n      if (grp.active === false) continue;\n      const classIds = Array.isArray(grp.classIds) ? grp.classIds : [];\n      if (classIds.length < 2) continue;\n      const groupEntries = (scope.entries || []).filter(e => classIds.includes(e.classId) && e.groupId === grp.id);\n      for (const e of groupEntries) {\n        const clash = (scope.entries || []).find(x => x.id !== e.id && Number(x.day) === Number(e.day) && x.periodId === e.periodId && classIds.includes(x.classId) && x.groupId !== grp.id);\n        if (clash) push('H14', `合班课冲突：${className(e.classId)} 在 ${slotKey(e.day, e.periodId)} 同时安排了合班课和本班课`, { entryId: clash.id, classId: e.classId, day: e.day, periodId: e.periodId });\n      }\n    }\n  }\n\n  // TRAVEL_BUFFER: cross-grade consecutive lessons need a gap.\n  if (isRuleOn(scope, 'TRAVEL_BUFFER')) {\n    const minGap = Number(ruleParam(scope, 'TRAVEL_BUFFER', 'minGapMinutes', 10));\n    const gradeOf = id => {\n      const cls = (scope.classes || []).find(c => c.id === id);\n      return cls ? ((scope.grades || []).find(g => g.id === cls.gradeId)?.name || cls.gradeId || '') : '';\n    };\n    for (const teacherId of [...new Set((scope.entries || []).map(e => e.teacherId))]) {\n      for (let day = 1; day <= days; day++) {\n        const list = (scope.entries || []).filter(e => e.teacherId === teacherId && Number(e.day) === day)\n          .map(e => ({ e, p: (scope.settings?.periods || []).find(p => p.id === e.periodId) }))\n          .filter(x => x.p && !x.p.isBreak)\n          .sort((a, b) => timeToMinutes(a.p.startTime) - timeToMinutes(b.p.startTime));\n        for (let i = 1; i < list.length; i++) {\n          const prev = list[i - 1], cur = list[i];\n          const g1 = gradeOf(prev.e.classId), g2 = gradeOf(cur.e.classId);\n          if (!g1 || !g2 || g1 === g2) continue;\n          const gap = timeToMinutes(cur.p.startTime) - timeToMinutes(prev.p.endTime);\n          if (gap < minGap) push('M12', `跨年级赶路时间不足：${scope.teacherGradeMap?.[teacherId]?.name || teacherId} 从 ${g1} 到 ${g2} 仅间隔 ${gap} 分钟`, { entryId: cur.e.id, teacherId, day });\n        }\n      }\n    }\n  }\n\n  // SUBJECT_BALANCE: skill/minor subjects should not pile up on one day.\n  if (isRuleOn(scope, 'SUBJECT_BALANCE')) {\n    const maxSame = Number(ruleParam(scope, 'SUBJECT_BALANCE', 'maxSameCategoryPerDay', 3));\n    const skillNames = ['体育', '音乐', '美术', '信息', '信息技术', '科学', '活动'];\n    for (const cls of (scope.classes || [])) {\n      for (let day = 1; day <= days; day++) {\n        const list = (scope.entries || []).filter(e => e.classId === cls.id && Number(e.day) === day);\n        const skill = list.filter(e => {\n          const subj = scope.subjects.find(s => s.id === e.subjectId);\n          return subj && (subj.tier === 'minor' || subj.tier === 'skill' || skillNames.some(n => subj.name.includes(n)));\n        });\n        if (skill.length > maxSame) push('M14', `${cls.name} 周${day} 技能/活动类课程 ${skill.length} 节，超过均衡上限 ${maxSame} 节`, { classId: cls.id, day });\n      }\n    }\n  }\n\n  // GRADE_WEEKLY_LIMIT: grade-level weekly total.\n  if (isRuleOn(scope, 'GRADE_WEEKLY_LIMIT')) {\n    const defaultMax = Number(ruleParam(scope, 'GRADE_WEEKLY_LIMIT', 'defaultMax', 40));\n    for (const grade of (scope.grades || [])) {\n      const classIds = (scope.classes || []).filter(c => c.gradeId === grade.id).map(c => c.id);\n      if (!classIds.length) continue;\n      const cap = Number(grade.maxWeeklyPeriods || defaultMax);\n      const perClass = (scope.entries || []).filter(e => classIds.includes(e.classId)).length / classIds.length;\n      if (perClass > cap) push('M13', `${grade.name} 平均每班周课时 ${perClass.toFixed(1)} 节，超过上限 ${cap} 节`, { gradeId: grade.id });\n    }\n  }\n\n  // RESERVE_SLACK: leave 1–2 free slots per class each week.\n  if (isRuleOn(scope, 'RESERVE_SLACK')) {\n    const minFree = Number(ruleParam(scope, 'RESERVE_SLACK', 'minFreeSlots', 2));\n    const capacity = days * periods.length;\n    for (const cls of (scope.classes || [])) {\n      const used = (scope.entries || []).filter(e => e.classId === cls.id).length;\n      if (capacity - used < minFree) push('M15', `${cls.name} 本周仅剩 ${capacity - used} 个空时段，建议预留 ${minFree} 节机动时间`, { classId: cls.id });\n    }\n  }\n  return issues;\n}\n\nfunction buildThreeTableAudit(scope) {\n  const byTeacher = {};\n  const byClass = {};\n  const byRoom = {};\n  for (const e of (scope.entries || [])) {\n    const key = `周${e.day} ${e.periodId}`;\n    (byTeacher[e.teacherId] ||= []).push(key);\n    (byClass[e.classId] ||= []).push(key);\n    if (e.roomId) (byRoom[e.roomId] ||= []).push(key);\n  }\n  const rows = (map, nameOf) => Object.entries(map).map(([id, slots]) => ({ id, name: nameOf(id), count: slots.length, slots }));\n  return {\n    teachers: rows(byTeacher, id => scope.teacherGradeMap?.[id]?.name || id),\n    classes: rows(byClass, id => scope.classes.find(c => c.id === id)?.name || id),\n    rooms: rows(byRoom, id => scope.rooms.find(r => r.id === id)?.name || id),\n  };\n}\n\nfunction detectAllConflicts(scope) {\n  const list = [];\n  for (const e of scope.entries) {\n    const others = new Set([e.id]);\n    const res = checkPlacement(scope, e, others);\n    if (res.hard.length || res.warnings.length) {\n      list.push({ entryId: e.id, day: e.day, periodId: e.periodId, classId: e.classId, teacherId: e.teacherId, subjectId: e.subjectId, hard: res.hard, warnings: res.warnings });\n    }\n  }\n  return tagIssues(scope, list.concat(detectGlobalIssues(scope), detectRuleKeywordIssues(scope)));\n}\n\nfunction scoreSlot(scope, plan, subj, tr, day, periodId) {\n  let score = 100;\n  if (subj?.tier === 'major' && isMorningPeriod(scope, periodId)) score += 30;\n  if (subj?.tier === 'minor' && !isMorningPeriod(scope, periodId)) score += 10;\n  if (subj?.preference === 'morning' && isMorningPeriod(scope, periodId)) score += 25;\n  if (subj?.preference === 'afternoon' && !isMorningPeriod(scope, periodId)) score += 25;\n  if (subj?.avoidLastPeriod && isLastPeriod(scope, periodId)) score -= 25;\n  if (subj?.tier !== 'major' && day === 1 && isFirstPeriod(scope, periodId)) score -= 15;\n  if (subj?.tier !== 'major' && day === Number(scope.settings?.daysPerWeek || 5) && isLastPeriod(scope, periodId)) score -= 15;\n  // Balance daily load for class\n  const classDayLoad = scope.entries.filter(e => e.classId === plan.classId && Number(e.day) === day).length;\n  score -= classDayLoad * 6;\n  // Spread subject across different days\n  const sameSubjSameDay = scope.entries.filter(e => e.classId === plan.classId && e.subjectId === plan.subjectId && Number(e.day) === day).length;\n  score -= sameSubjSameDay * (isRuleOn(scope, 'SUBJECT_DAILY_LIMIT') ? 35 : 10);\n  // Balance teacher load across days\n  const teacherDayLoad = scope.entries.filter(e => e.teacherId === plan.teacherId && Number(e.day) === day).length;\n  score -= teacherDayLoad * 5;\n  if (tr?.preference === 'morning' && isMorningPeriod(scope, periodId)) score += 15;\n  if (tr?.preference === 'afternoon' && !isMorningPeriod(scope, periodId)) score += 15;\n  return score;\n}\n\n// Finds adjacent teaching period pairs that do NOT cross a break/lunch!\nfunction adjacentPeriodPairs(scope, count = 2) {\n  const all = scope.settings?.periods || [];\n  const pairs = [];\n  for (let i = 0; i <= all.length - count; i++) {\n    const slice = all.slice(i, i + count);\n    if (slice.every(p => !p.isBreak)) pairs.push(slice.map(p => p.id));\n  }\n  return pairs;\n}\n\nfunction autoSchedule(scope, options = {}) {\n  const days = Number(scope.settings?.daysPerWeek || 5);\n  const tPeriods = teachingPeriods(scope);\n  // Keep locked entries (or entries matching filter)\n  const gradeFilter = options.gradeId ? new Set(scope.classes.filter(c => c.gradeId === options.gradeId).map(c => c.id)) : null;\n  const kept = scope.entries.filter(e => e.locked || (gradeFilter && !gradeFilter.has(e.classId)));\n  scope.entries = kept.map(e => ({ ...e }));\n\n  const targetPlans = scope.plans.filter(p => !gradeFilter || gradeFilter.has(p.classId));\n  // Sort plans: fixed first -> consecutive -> major -> minor -> public -> highest weeklyHours\n  const tierRank = { major: 3, minor: 2, public: 1 };\n  const sortedPlans = targetPlans.slice().sort((a, b) => {\n    if (Boolean(a.fixed) !== Boolean(b.fixed)) return a.fixed ? -1 : 1;\n    const sa = scope.subjects.find(s => s.id === a.subjectId);\n    const sb = scope.subjects.find(s => s.id === b.subjectId);\n    const ca = sa?.consecutiveMode === 'require' ? 1 : 0;\n    const cb = sb?.consecutiveMode === 'require' ? 1 : 0;\n    if (ca !== cb) return cb - ca;\n    const ta = tierRank[sa?.tier] || 2;\n    const tb = tierRank[sb?.tier] || 2;\n    if (ta !== tb) return tb - ta;\n    return Number(b.weeklyHours || 0) - Number(a.weeklyHours || 0);\n  });\n\n  const unplaced = [];\n  let placedCount = 0;\n\n  const groupedPlanIds = new Set((scope.combinedGroups || []).flatMap(g => g.planIds || []));\n  for (const grp of (scope.combinedGroups || [])) {\n    if (gradeFilter && !grp.classIds.some(cid => gradeFilter.has(cid))) continue;\n    const grpPlans = scope.plans.filter(pl => grp.planIds.includes(pl.id));\n    if (!grpPlans.length) continue;\n    const existingCount = scope.entries.filter(e => e.groupId === grp.id && e.classId === grp.classIds[0]).length;\n    let remaining = Math.max(0, Number(grp.weeklyHours || grpPlans[0].weeklyHours || 0) - existingCount);\n    const subj = scope.subjects.find(s => s.id === grp.subjectId);\n    const tr = scope.teacherRules[grp.teacherId] || {};\n    while (remaining > 0) {\n      const candidates = [];\n      for (let day = 1; day <= days; day++) {\n        for (const p of tPeriods) {\n          const checks = grp.classIds.map(cid => checkPlacement(scope, {\n            groupId: grp.id, planId: grpPlans[0].id, classId: cid, subjectId: grp.subjectId,\n            teacherId: grp.teacherId, roomId: grp.roomId || null, day, periodId: p.id,\n          }));\n          if (checks.every(c => c.valid)) {\n            const penalty = checks.reduce((sum, c) => sum + c.warnings.length * 10, 0);\n            candidates.push({ day, periodId: p.id, score: scoreSlot(scope, grpPlans[0], subj, tr, day, p.id) - penalty });\n          }\n        }\n      }\n      if (!candidates.length) {\n        unplaced.push({ groupId: grp.id, classId: grp.classIds[0], subjectId: grp.subjectId, teacherId: grp.teacherId, remaining });\n        break;\n      }\n      candidates.sort((a, b) => b.score - a.score);\n      const best = candidates[0];\n      for (const cid of grp.classIds) {\n        const pl = grpPlans.find(x => x.classId === cid) || grpPlans[0];\n        scope.entries.push({\n          id: id('ent'), groupId: grp.id, planId: pl.id, classId: cid, subjectId: grp.subjectId,\n          teacherId: grp.teacherId, roomId: grp.roomId || null, day: best.day, periodId: best.periodId,\n          locked: false, temporary: false, overrideReason: '', updatedAt: now(),\n        });\n      }\n      remaining--;\n      placedCount += grp.classIds.length;\n    }\n  }\n\n  for (const plan of sortedPlans) {\n    if (groupedPlanIds.has(plan.id)) continue;\n    const existingCount = scope.entries.filter(e => e.classId === plan.classId && e.subjectId === plan.subjectId && e.teacherId === plan.teacherId).length;\n    let remaining = Math.max(0, Number(plan.weeklyHours || 0) - existingCount);\n    const subj = scope.subjects.find(s => s.id === plan.subjectId);\n    const tr = scope.teacherRules[plan.teacherId] || {};\n\n    // Place consecutive blocks first if required\n    if (subj?.consecutiveMode === 'require' && remaining >= 2) {\n      const blockSize = Math.min(Number(subj.consecutiveCount || 2), remaining);\n      const pairs = adjacentPeriodPairs(scope, blockSize);\n      const maxBlocks = Number(subj.maxConsecutivePerWeek || 2);\n      let blocksPlaced = 0;\n      while (remaining >= blockSize && blocksPlaced < maxBlocks) {\n        const candidates = [];\n        for (let day = 1; day <= days; day++) {\n          for (const pIds of pairs) {\n            const checks = pIds.map(pid => checkPlacement(scope, { ...plan, day, periodId: pid }));\n            if (checks.every(c => c.valid)) {\n              const totalScore = pIds.reduce((sum, pid) => sum + scoreSlot(scope, plan, subj, tr, day, pid), 0);\n              candidates.push({ day, pIds, score: totalScore });\n            }\n          }\n        }\n        if (!candidates.length) break;\n        candidates.sort((a, b) => b.score - a.score);\n        const best = candidates[0];\n        for (const pid of best.pIds) {\n          scope.entries.push({\n            id: id('ent'), planId: plan.id, classId: plan.classId, subjectId: plan.subjectId,\n            teacherId: plan.teacherId, roomId: plan.roomId || null, day: best.day, periodId: pid,\n            locked: Boolean(plan.fixed), temporary: false, overrideReason: '', updatedAt: now(),\n          });\n          remaining--;\n          placedCount++;\n        }\n        blocksPlaced++;\n      }\n    }\n\n    // Place remaining single lessons\n    while (remaining > 0) {\n      const candidates = [];\n      for (let day = 1; day <= days; day++) {\n        for (const p of tPeriods) {\n          const chk = checkPlacement(scope, { ...plan, day, periodId: p.id });\n          if (chk.valid) {\n            const penalty = chk.warnings.length * 20;\n            candidates.push({ day, periodId: p.id, score: scoreSlot(scope, plan, subj, tr, day, p.id) - penalty });\n          }\n        }\n      }\n      if (!candidates.length) {\n        unplaced.push({ planId: plan.id, classId: plan.classId, subjectId: plan.subjectId, teacherId: plan.teacherId, remaining });\n        break;\n      }\n      candidates.sort((a, b) => b.score - a.score);\n      const best = candidates[0];\n      scope.entries.push({\n        id: id('ent'), planId: plan.id, classId: plan.classId, subjectId: plan.subjectId,\n        teacherId: plan.teacherId, roomId: plan.roomId || null, day: best.day, periodId: best.periodId,\n        locked: Boolean(plan.fixed), temporary: false, overrideReason: '', updatedAt: now(),\n      });\n      remaining--;\n      placedCount++;\n    }\n  }\n\n  return { placedCount, unplaced, conflicts: detectAllConflicts(scope), totalEntries: scope.entries.length };\n}\n\nfunction suggestAlternatives(scope, entryOrPlan, limit = 3) {\n  const days = Number(scope.settings?.daysPerWeek || 5);\n  const tPeriods = teachingPeriods(scope);\n  const subj = scope.subjects.find(s => s.id === entryOrPlan.subjectId);\n  const tr = scope.teacherRules[entryOrPlan.teacherId] || {};\n  const ignore = entryOrPlan.id ? new Set([entryOrPlan.id]) : new Set();\n  const options = [];\n  for (let day = 1; day <= days; day++) {\n    for (const p of tPeriods) {\n      const chk = checkPlacement(scope, { ...entryOrPlan, day, periodId: p.id }, ignore);\n      if (chk.valid) {\n        options.push({ day, periodId: p.id, periodName: p.name, startTime: p.startTime, endTime: p.endTime, score: scoreSlot(scope, entryOrPlan, subj, tr, day, p.id) - chk.warnings.length * 20 });\n      }\n    }\n  }\n  options.sort((a, b) => b.score - a.score);\n  return options.slice(0, limit);\n}\n\nfunction suggestSubstitutes(scope, allTeachers, day, periodId, subjectId) {\n  return allTeachers.filter(t => {\n    if (t.active === false) return false;\n    const busy = scope.entries.some(e => Number(e.day) === Number(day) && e.periodId === periodId && e.teacherId === t.id);\n    if (busy) return false;\n    const tr = scope.teacherRules[t.id] || {};\n    if (Array.isArray(tr.blockedSlots) && tr.blockedSlots.includes(slotKey(day, periodId))) return false;\n    return true;\n  }).slice(0, 5).map(t => ({ id: t.id, name: t.name, department: t.department || '' }));\n}\n\n\n// --- Module 2: Smart Student Placement (智能分班) ---\nfunction runSmartPlacement(studentsInput, config = {}) {\n  const students = (studentsInput || []).map((s, idx) => ({\n    ...s,\n    id: s.id || `pstu_${idx + 1}`,\n    gender: String(s.gender || '').trim(),\n    total: Number(s.scores?.total ?? s.total ?? 0),\n    chinese: Number(s.scores?.chinese ?? s.chinese ?? 0),\n    math: Number(s.scores?.math ?? s.math ?? 0),\n    english: Number(s.scores?.english ?? s.english ?? 0),\n    rank: Number(s.rank || 0),\n    specialty: String(s.tags?.specialty ?? s.specialty ?? '').trim(),\n    bindGroup: String(s.bindGroup || '').trim(),\n    mutexGroup: String(s.mutexGroup || '').trim(),\n  }));\n  const classCount = Math.max(1, Math.min(50, Number(config.classCount || 2)));\n  const prefix = String(config.classPrefix || '新生').trim();\n  const mode = config.mode || 'total'; // total | subjects | rankBand | percentTier\n  const genderBalance = config.genderBalance !== false;\n\n  const classes = Array.from({ length: classCount }, (_, i) => ({\n    index: i + 1,\n    name: `${prefix}(${i + 1})班`,\n    students: [],\n    male: 0,\n    female: 0,\n    sumTotal: 0,\n    sumChinese: 0,\n    sumMath: 0,\n    sumEnglish: 0,\n    tagCounts: {},\n    mutexGroups: new Set(),\n  }));\n\n  // Group bound students (twins/siblings) into atomic units\n  const bindMap = new Map();\n  const units = [];\n  for (const stu of students) {\n    if (stu.bindGroup) {\n      if (!bindMap.has(stu.bindGroup)) {\n        const unit = { members: [], avgScore: 0 };\n        bindMap.set(stu.bindGroup, unit);\n        units.push(unit);\n      }\n      bindMap.get(stu.bindGroup).members.push(stu);\n    } else {\n      units.push({ members: [stu], avgScore: stu.total });\n    }\n  }\n  for (const u of units) {\n    u.avgScore = u.members.reduce((s, m) => s + m.total, 0) / u.members.length;\n    u.rank = Math.min(...u.members.map(m => m.rank || 999999));\n  }\n\n  // Sort units according to mode\n  if (mode === 'rankBand') {\n    units.sort((a, b) => a.rank - b.rank || b.avgScore - a.avgScore);\n  } else if (mode === 'subjects') {\n    units.sort((a, b) => {\n      const sa = a.members.reduce((s, m) => s + m.chinese + m.math + m.english + m.total, 0) / a.members.length;\n      const sb = b.members.reduce((s, m) => s + m.chinese + m.math + m.english + m.total, 0) / b.members.length;\n      return sb - sa;\n    });\n  } else {\n    units.sort((a, b) => b.avgScore - a.avgScore);\n  }\n\n  // Serpentine / balanced assignment respecting mutexGroups, gender, tags, and score\n  const isMale = g => /^(男|male|m)$/i.test(g);\n  const isFemale = g => /^(女|female|f)$/i.test(g);\n\n  for (let i = 0; i < units.length; i++) {\n    const unit = units[i];\n    const unitMutex = unit.members.map(m => m.mutexGroup).filter(Boolean);\n    const eligible = classes.filter(c => !unitMutex.some(mg => c.mutexGroups.has(mg)));\n    const pool = eligible.length ? eligible : classes;\n\n    // Score each candidate class (lower cost = better)\n    pool.sort((a, b) => {\n      let costA = a.students.length * 100;\n      let costB = b.students.length * 100;\n      if (genderBalance) {\n        const uMale = unit.members.filter(m => isMale(m.gender)).length;\n        const uFemale = unit.members.filter(m => isFemale(m.gender)).length;\n        costA += uMale * a.male * 35 + uFemale * a.female * 35;\n        costB += uMale * b.male * 35 + uFemale * b.female * 35;\n      }\n      for (const m of unit.members) {\n        if (m.specialty) {\n          costA += (a.tagCounts[m.specialty] || 0) * 40;\n          costB += (b.tagCounts[m.specialty] || 0) * 40;\n        }\n      }\n      const avgA = a.students.length ? a.sumTotal / a.students.length : 0;\n      const avgB = b.students.length ? b.sumTotal / b.students.length : 0;\n      costA += avgA * 0.2;\n      costB += avgB * 0.2;\n      return costA - costB || a.index - b.index;\n    });\n\n    const target = pool[0];\n    for (const m of unit.members) {\n      target.students.push(m);\n      if (isMale(m.gender)) target.male++;\n      else if (isFemale(m.gender)) target.female++;\n      target.sumTotal += m.total;\n      target.sumChinese += m.chinese;\n      target.sumMath += m.math;\n      target.sumEnglish += m.english;\n      if (m.specialty) target.tagCounts[m.specialty] = (target.tagCounts[m.specialty] || 0) + 1;\n      if (m.mutexGroup) target.mutexGroups.add(m.mutexGroup);\n    }\n  }\n\n  return classes.map(c => ({\n    name: c.name,\n    count: c.students.length,\n    male: c.male,\n    female: c.female,\n    avgTotal: c.students.length ? Number((c.sumTotal / c.students.length).toFixed(2)) : 0,\n    avgChinese: c.students.length ? Number((c.sumChinese / c.students.length).toFixed(2)) : 0,\n    avgMath: c.students.length ? Number((c.sumMath / c.students.length).toFixed(2)) : 0,\n    avgEnglish: c.students.length ? Number((c.sumEnglish / c.students.length).toFixed(2)) : 0,\n    tagCounts: c.tagCounts,\n    students: c.students,\n  }));\n}\n\n// --- Module 3: Exam Proctoring Auto-Scheduler (自动排监考) ---\nfunction autoAssignProctors(scope, exam, allTeachers) {\n  const rules = exam.rules || { taughtClass: 'avoid', taughtSubject: 'avoid', proctorsPerRoom: 1 };\n  const perRoom = Math.max(1, Math.min(3, Number(rules.proctorsPerRoom || 1)));\n  const poolIds = Array.isArray(exam.teacherIds) && exam.teacherIds.length ? exam.teacherIds : allTeachers.filter(t => t.active !== false).map(t => t.id);\n  const dutyCount = new Map(poolIds.map(tid => [tid, 0]));\n  const assignments = [];\n  const warnings = [];\n\n  for (const slot of (exam.slots || [])) {\n    const busyInSlot = new Set();\n    // Exclude teachers who are teaching a class at this day/periodId\n    if (slot.dayOfWeek && slot.periodId) {\n      for (const e of scope.entries) {\n        if (Number(e.day) === Number(slot.dayOfWeek) && e.periodId === slot.periodId) {\n          busyInSlot.add(e.teacherId);\n        }\n      }\n    }\n\n    for (const room of (exam.rooms || [])) {\n      const picked = [];\n      const roomWarnings = [];\n      for (let k = 0; k < perRoom; k++) {\n        const candidates = poolIds.filter(tid => !busyInSlot.has(tid) && !picked.includes(tid));\n        if (!candidates.length) {\n          roomWarnings.push('可用监考教师不足');\n          break;\n        }\n        candidates.sort((a, b) => {\n          let scoreA = -(dutyCount.get(a) || 0) * 50;\n          let scoreB = -(dutyCount.get(b) || 0) * 50;\n\n          const teachesClassA = room.classId ? scope.plans.some(p => p.classId === room.classId && p.teacherId === a) : false;\n          const teachesClassB = room.classId ? scope.plans.some(p => p.classId === room.classId && p.teacherId === b) : false;\n          if (rules.taughtClass === 'avoid') { scoreA += teachesClassA ? -100 : 20; scoreB += teachesClassB ? -100 : 20; }\n          else if (rules.taughtClass === 'prefer' && k === 0) { scoreA += teachesClassA ? 100 : 0; scoreB += teachesClassB ? 100 : 0; }\n\n          const teachesSubjA = slot.subjectId ? scope.plans.some(p => p.subjectId === slot.subjectId && p.teacherId === a) : false;\n          const teachesSubjB = slot.subjectId ? scope.plans.some(p => p.subjectId === slot.subjectId && p.teacherId === b) : false;\n          if (rules.taughtSubject === 'avoid') { scoreA += teachesSubjA ? -80 : 15; scoreB += teachesSubjB ? -80 : 15; }\n          else if (rules.taughtSubject === 'prefer' && k === 0) { scoreA += teachesSubjA ? 80 : 0; scoreB += teachesSubjB ? 80 : 0; }\n\n          return scoreB - scoreA;\n        });\n\n        const chosen = candidates[0];\n        picked.push(chosen);\n        busyInSlot.add(chosen);\n        dutyCount.set(chosen, (dutyCount.get(chosen) || 0) + 1);\n      }\n      if (roomWarnings.length) warnings.push({ slotId: slot.id, roomId: room.id, message: roomWarnings[0] });\n      assignments.push({ id: id('pro'), slotId: slot.id, roomId: room.id, teacherIds: picked, warnings: roomWarnings });\n    }\n  }\n  exam.assignments = assignments;\n  return { assignments, warnings, dutyCount: Object.fromEntries(dutyCount) };\n}\n\nmodule.exports = {\n  id, now, defaultPeriods, emptyScope, ensureScope,\n  RULE_CATALOG, RULE_CATEGORY_LABELS, defaultRuleConfig, normalizeRuleConfig, getRuleConfig, isRuleOn, listRules, tagIssues, detectRuleKeywordIssues,\n  checkPlacement, detectAllConflicts, detectGlobalIssues, buildThreeTableAudit, autoSchedule,\n  suggestAlternatives, suggestSubstitutes,\n  runSmartPlacement, autoAssignProctors,\n};\n";
let sched;
try {
  const EngineModule = require('node:module');
  const engine = new EngineModule('embedded-scheduling-engine', module);
  engine.filename = path.join(__dirname, 'scheduling.js');
  engine.paths = EngineModule._nodeModulePaths(__dirname);
  engine._compile(SCHEDULING_ENGINE_FULL, engine.filename);
  if (!engine.exports || typeof engine.exports.detectAllConflicts !== 'function') throw new Error('embedded scheduling engine is incomplete');
  sched = engine.exports;
} catch (err) {
  sched = require('./scheduling');
}
const resetMail = require('./email-smtp');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(DATA_DIR, 'platform.json');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(path.dirname(DATA_FILE), 'uploads');
const sessions = new Map();
const loginFailures = new Map();
const SESSION_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_BODY = 20_000_000;
const MAX_VIDEO = 80 * 1024 * 1024;
const MAX_ASSIGNMENT_FILE = 15 * 1024 * 1024;
const MAX_AVATAR = 3 * 1024 * 1024;
const MAX_RESOURCE_FILE = 15 * 1024 * 1024;
const MAX_FOLDER_FILES = 50;
const RESET_MS = 30 * 60 * 1000;
const resetTokens = new Map();
const resetAttempts = new Map();
const SCHOOL_STAGES = Object.freeze({
  kindergarten: '幼儿园', primary: '小学', middle: '中学', vocational: '职业学校',
  technical: '技工学校', university: '大学', general: '普通教育教学机构'
});
const DEPARTMENT_CODE_PREFIXES = Object.freeze({
  '教育': 'J', '计算机': 'J', '数学': 'S', '生命': 'S', '物理': 'W', '化学': 'H',
  '语文': 'Y', '中文': 'Y', '文学': 'W', '外语': 'W', '英语': 'Y', '经济': 'J',
  '管理': 'G', '工程': 'G', '医学': 'Y', ' law': 'F', '法': 'F', '艺术': 'Y',
  '体育': 'T', '音乐': 'Y', '美术': 'M', '历史': 'L', '哲学': 'Z', '新闻': 'X',
  '传播': 'C', '农业': 'N', '建筑': 'J', '交通': 'J', '软件': 'R', '人工智能': 'R'
});
const DEFAULT_WEIGHTS = Object.freeze({ usual: 30, quiz: 20, midterm: 20, final: 30 });
const GRADE_KEYS = Object.keys(DEFAULT_WEIGHTS);

const TEACHER_POSITIONS = [
  '校长',
  '副校长',
  '院长',
  '副院长',
  '教务处长',
  '课题组长',
  '教师'
];
const POSITION_RANK = {
  '校长': 7,
  '副校长': 6,
  '院长': 5,
  '副院长': 4,
  '教务处长': 3,
  '课题组长': 2,
  '教师': 1
};
function normalizePosition(pos) {
  const val = String(pos || '').trim();
  return TEACHER_POSITIONS.includes(val) ? val : '教师';
}
function positionRankOf(u) {
  if (!u || u.role !== 'teacher') return 0;
  return POSITION_RANK[normalizePosition(u.position)] || 1;
}
// Determines whether viewer (teacher or admin) can inspect target user's profile/activity/courses
function canInspectSubordinate(viewer, target) {
  if (!viewer || !target || viewer.id === target.id) return true;
  if (viewer.role === 'admin') return canAdminManage(viewer, target);
  if (viewer.role !== 'teacher') return false;
  if (viewer.schoolId && target.schoolId && viewer.schoolId !== target.schoolId) return false;
  if (viewer.schoolId && !target.schoolId) return false;
  const pos = normalizePosition(viewer.position);
  if (pos === '教师') return false;
  if (target.role === 'student') {
    if (['校长', '副校长', '教务处长'].includes(pos)) return true;
    if (['院长', '副院长'].includes(pos)) {
      return Boolean(viewer.department && target.department === viewer.department);
    }
    if (pos === '课题组长') {
      const myCourseIds = new Set(db.courses.filter(c => isCourseTeacher(viewer, c)).map(c => c.id));
      return db.enrollments.some(e => e.userId === target.id && myCourseIds.has(e.courseId));
    }
    return false;
  }
  if (target.role === 'teacher') {
    const vRank = positionRankOf(viewer);
    const tRank = positionRankOf(target);
    if (vRank <= tRank) return false;
    if (['校长', '副校长', '教务处长'].includes(pos)) return true;
    if (['院长', '副院长', '课题组长'].includes(pos)) {
      return Boolean(viewer.department && target.department === viewer.department);
    }
    return false;
  }
  return false;
}
// Courses visible to a teacher for oversight/monitoring based on Chinese university governance rules
function visibleCoursesForTeacher(teacher) {
  const pos = normalizePosition(teacher.position);
  return db.courses.filter(c => {
    if (isCourseTeacher(teacher, c)) return true;
    const tIds = courseTeacherIds(c);
    const courseTeachers = tIds.map(tid => db.users.find(u => u.id === tid)).filter(Boolean);
    if (teacher.schoolId) {
      const sameSchool = c.schoolId === teacher.schoolId || courseTeachers.some(t => t.schoolId === teacher.schoolId);
      if (!sameSchool) return false;
    }
    if (['校长', '副校长', '教务处长'].includes(pos)) return true;
    if (['院长', '副院长'].includes(pos)) {
      return Boolean(teacher.department && courseTeachers.some(t => t.department === teacher.department));
    }
    if (pos === '课题组长') {
      return Boolean(teacher.department && courseTeachers.some(t => t.department === teacher.department && positionRankOf(t) < positionRankOf(teacher)));
    }
    return false;
  });
}

function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function now() { return new Date().toISOString(); }
function newEnrollmentCode(existing) {
  let code;
  do { code = crypto.randomBytes(5).toString('hex').toUpperCase(); }
  while (existing.some(course => course.enrollmentCode === code));
  return code;
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(actual, expectedBuffer);
}
function ensureSeed() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (process.env.DEMO_SEED !== '1') {
    const empty = { users: [], schools: [], courses: [], enrollments: [], quizzes: [], attempts: [], posts: [], activity: [], assignments: [], submissions: [], grades: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(empty, null, 2), { mode: 0o600 });
    return empty;
  }
  const teacher = {
    id: id('user'), role: 'teacher', name: process.env.DEMO_TEACHER_NAME || 'Instructor Lee',
    email: (process.env.DEMO_TEACHER_EMAIL || 'teacher@university.edu').toLowerCase(),
    studentId: null, passwordHash: hashPassword(process.env.DEMO_TEACHER_PASSWORD || 'Teacher123!'),
    createdAt: now()
  };
  const seedCourses = [
    { title: 'Learning in the Digital Age', category: 'General Education', description: 'Develop independent learning, research, and knowledge-management skills with clear feedback at every step.', cover: 'learning', color: '#6c5ce7', lessons: [
      ['Getting Started with Independent Learning', 'video', '12 min', 'University learning begins with clear goals. Set one measurable goal for this week and break it into daily actions.', ''],
      ['Finding and Evaluating Sources', 'reading', '18 min', 'Start with academic databases and primary sources. Check the author, publication date, and research methods. Keep citations and verify claims.', ''],
      ['Building a Personal Study Plan', 'reading', '15 min', 'Review your time, understanding, and next steps every week. Use spaced repetition and active recall to retain knowledge.', '']
    ], questions: [
      ['Which approach best checks whether you truly understand a concept?', ['Reread notes repeatedly', 'Recall and explain it without looking at notes', 'Only watch a video', 'Only save bookmarks'], 1],
      ['What should you check first when evaluating a source?', ['Page colors', 'The author and supporting evidence', 'Title length', 'Number of comments'], 1],
      ['What makes a study goal effective?', ['Keeping it vague', 'Making it measurable and time-bound', 'Never reviewing it', 'Depending entirely on peers'], 1]
    ] },
    { title: 'Introduction to Python Data Analysis', category: 'Digital Skills', description: 'Build practical data skills, from cleaning and visualization to interpreting results and solving real problems.', cover: 'data', color: '#198f86', lessons: [
      ['The Data Analysis Process', 'video', '14 min', 'Data analysis starts with defining a question, then collecting, cleaning, exploring, modeling, and communicating data. First decide what you need to answer.', ''],
      ['Cleaning and Organizing Data', 'reading', '20 min', 'Check missing values, duplicates, data types, and outliers. Document every decision so the result can be reproduced.', ''],
      ['Communicating Findings with Charts', 'reading', '17 min', 'Choose charts that fit the question: bars for comparison, lines for trends, and histograms for distributions. Label axes and units.', '']
    ], questions: [
      ['What is usually the first step in data analysis?', ['Choose chart colors', 'Define the question to solve', 'Train a model immediately', 'Delete all missing values'], 1],
      ['Which chart usually works best for trends over time?', ['Line chart', 'Pie chart', 'Word cloud', 'Scatter plot'], 0],
      ['What is the key principle when handling missing values?', ['Always delete them', 'Record and explain the chosen approach', 'Replace every value with zero', 'Ignore data types'], 1]
    ] },
    { title: 'Academic Research and Writing', category: 'Academic Skills', description: 'Learn to frame research questions, review literature, and cite sources responsibly in university-level work.', cover: 'research', color: '#dc8052', lessons: [
      ['Formulating a Research Question', 'video', '13 min', 'A research question should be clear, focused, and answerable with evidence. Define the subject, scope, and key concepts.', ''],
      ['Reading and Organizing Literature', 'reading', '22 min', 'Record each source’s argument, methods, and limitations, then compare how the studies connect.', ''],
      ['Citation and Academic Integrity', 'reading', '16 min', 'Cite ideas and data from others. Separate your own analysis from others’ work and retain complete references.', '']
    ], questions: [
      ['How should a good research question be framed?', ['As broadly as possible', 'Specifically enough to answer with evidence', 'As a personal opinion only', 'Without defining the scope'], 1],
      ['What is central to a literature review?', ['Copying studies in publication order', 'Comparing and synthesizing findings', 'Listing citations only', 'Ignoring research methods'], 1],
      ['What should you do when using someone else’s data?', ['Use it without explanation', 'Attribute and cite the source properly', 'Change the colors only', 'Mention it only in a presentation'], 1]
    ] }
  ];
  const db = { users: [teacher], schools: [], courses: [], enrollments: [], quizzes: [], attempts: [], posts: [], activity: [], assignments: [], submissions: [], grades: [] };
  for (const item of seedCourses) {
    const courseId = id('course');
    const { lessons: rawLessons, questions: rawQuestions, ...details } = item;
    const lessons = rawLessons.map(([title, type, duration, content, videoUrl], order) => ({ id: id('lesson'), title, type, duration, content, videoUrl, order, createdAt: now() }));
    db.courses.push({ id: courseId, ...details, teacherId: teacher.id, enrollmentCode: newEnrollmentCode(db.courses), gradeWeights: { ...DEFAULT_WEIGHTS }, lessons, createdAt: now(), updatedAt: now() });
    db.quizzes.push({ id: id('quiz'), courseId, title: `${item.title} · Knowledge Check`, questions: rawQuestions.map(([text, options, correctIndex]) => ({ id: id('question'), text, options, correctIndex })), updatedAt: now() });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), { mode: 0o600 });
  return db;
}
let db = ensureSeed();
let migrated = false;
if (!Array.isArray(db.schools)) { db.schools = []; migrated = true; }
for (const key of ['assignments', 'submissions', 'grades', 'departments', 'announcements', 'lessonQuizzes', 'lessonQuizAttempts', 'studentClasses']) if (!Array.isArray(db[key])) { db[key] = []; migrated = true; }
if (!Array.isArray(db.usedCourseCodes)) { db.usedCourseCodes = db.courses.map(c => c.enrollmentCode).filter(Boolean); migrated = true; }
for (const user of db.users) {
  if (typeof user.gender !== 'string') { user.gender = ''; migrated = true; }
  if (typeof user.grade !== 'string') { user.grade = ''; migrated = true; }
  if (typeof user.department !== 'string') { user.department = ''; migrated = true; }
  if (typeof user.major !== 'string') { user.major = ''; migrated = true; }
  if (user.role === 'teacher' && !TEACHER_POSITIONS.includes(user.position)) { user.position = '教师'; migrated = true; }
  if (!user.accountId && user.studentId) { user.accountId = user.studentId; migrated = true; }
  if (user.role === 'admin' && !user.schoolId && !user.adminScope) { user.adminScope = 'global'; migrated = true; }
}
for (const course of db.courses) {
  if (!course.enrollmentCode) { course.enrollmentCode = newEnrollmentCode(db.courses); migrated = true; }
  if (!course.gradeWeights) { course.gradeWeights = { ...DEFAULT_WEIGHTS }; migrated = true; }
  if (!course.gradePublication) { course.gradePublication = { status: 'published', publishedAt: course.updatedAt || now(), publishedBy: null, snapshot: null }; migrated = true; }
  if (!Array.isArray(course.announcements)) { course.announcements = []; migrated = true; }
  if (!Array.isArray(course.targetDepartments)) { course.targetDepartments = []; migrated = true; }
  if (!Array.isArray(course.targetMajors)) { course.targetMajors = []; migrated = true; }
  if (!Array.isArray(course.targetClassIds)) { course.targetClassIds = []; migrated = true; }
  if (typeof course.academicYear !== 'string') { course.academicYear = ''; migrated = true; }
  if (typeof course.autoEnroll !== 'boolean') { course.autoEnroll = false; migrated = true; }
}
// An administrator exists only if deployment credentials are explicitly provided.
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && !db.users.some(u => u.role === 'admin')) {
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128) throw new Error('ADMIN_EMAIL must be valid and ADMIN_PASSWORD must have 12–128 characters');
  if (db.users.some(u => u.email.toLowerCase() === email)) throw new Error('ADMIN_EMAIL is already assigned to another account');
  db.users.push({ id: id('user'), role: 'admin', adminScope: 'global', name: process.env.ADMIN_NAME?.trim().slice(0, 60) || 'Site Administrator', email, studentId: null, passwordHash: hashPassword(password), active: true, createdAt: now() });
  migrated = true;
}
function migrateDb(target) {
  let changed = false;
  if (!Array.isArray(target.schools)) { target.schools = []; changed = true; }
  if (!target.scheduling || typeof target.scheduling !== 'object') { target.scheduling = {}; changed = true; }
  for (const key of ['assignments', 'submissions', 'grades', 'departments', 'announcements', 'lessonQuizzes', 'lessonQuizAttempts', 'studentClasses']) {
    if (!Array.isArray(target[key])) { target[key] = []; changed = true; }
  }
  if (!Array.isArray(target.usedCourseCodes)) { target.usedCourseCodes = (target.courses || []).map(c => c.enrollmentCode).filter(Boolean); changed = true; }
  for (const user of (target.users || [])) {
    if (typeof user.gender !== 'string') { user.gender = ''; changed = true; }
    if (typeof user.grade !== 'string') { user.grade = ''; changed = true; }
    if (typeof user.department !== 'string') { user.department = ''; changed = true; }
    if (typeof user.major !== 'string') { user.major = ''; changed = true; }
    if (!user.accountId && user.studentId) { user.accountId = user.studentId; changed = true; }
    if (user.role === 'admin' && !user.schoolId && !user.adminScope) { user.adminScope = 'global'; changed = true; }
  }
  for (const course of (target.courses || [])) {
    if (!course.enrollmentCode) { course.enrollmentCode = newEnrollmentCode(target.courses); changed = true; }
    if (!course.gradeWeights) { course.gradeWeights = { ...DEFAULT_WEIGHTS }; changed = true; }
    if (!Array.isArray(course.announcements)) { course.announcements = []; changed = true; }
    if (!Array.isArray(course.targetDepartments)) { course.targetDepartments = []; changed = true; }
    if (!Array.isArray(course.targetMajors)) { course.targetMajors = []; changed = true; }
    if (!Array.isArray(course.targetClassIds)) { course.targetClassIds = []; changed = true; }
    if (typeof course.academicYear !== 'string') { course.academicYear = ''; changed = true; }
    if (typeof course.autoEnroll !== 'boolean') { course.autoEnroll = false; changed = true; }
  }
  return changed;
}
let remoteSaveChain = Promise.resolve();
function queueRemoteDbSave() {
  const cfg = storage.getConfig();
  if (!cfg.enabled) return;
  const snapshot = JSON.stringify(db, null, 2);
  remoteSaveChain = remoteSaveChain
    .then(() => storage.putObject(cfg.dbKey, snapshot, 'application/json'))
    .catch(err => console.error('Remote DB sync error:', err.message));
}
function saveLocal() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DATA_FILE);
}
function save() {
  saveLocal();
  queueRemoteDbSave();
}
if (migrated) saveLocal();
const readyPromise = (async () => {
  const cfg = storage.getConfig();
  if (!cfg.enabled) return;
  try {
    const raw = await storage.getObject(cfg.dbKey);
    if (raw) {
      const parsed = JSON.parse(raw.toString('utf8'));
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.users)) {
        db = parsed;
        migrateDb(db);
        saveLocal();
      }
    } else if (db.users.length || db.schools.length || db.courses.length) {
      await storage.putObject(cfg.dbKey, JSON.stringify(db, null, 2), 'application/json');
    }
  } catch (err) {
    console.error('Remote DB bootstrap error:', err.message);
  }
})();

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function fail(status, message) { throw new HttpError(status, message); }
function json(res, status, value, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin', ...extra
  });
  res.end(JSON.stringify(value));
}
function sessionCookie(req, token, maxAge) {
  const secure = Boolean(req.socket.encrypted || (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https'));
  return `lms_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function getUser(req) {
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('lms_session='));
  if (!cookie) return null;
  const token = cookie.slice('lms_session='.length);
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const session = sessions.get(key);
  if (!session) return null;
  if (session.expiresAt < Date.now()) { sessions.delete(key); return null; }
  return db.users.find(u => u.id === session.userId && u.active !== false) || null;
}
function publicUser(user) {
  if (!user) return null;
  const memberClasses = user.role === 'student' ? (db.studentClasses || []).filter(c => (c.studentIds || []).includes(user.id)) : [];
  const school = db.schools.find(item => item.id === user.schoolId);
  const pendingSchool = user.pendingSchoolId ? db.schools.find(item => item.id === user.pendingSchoolId) : null;
  return { id: user.id, role: user.role, name: user.name, email: user.email, studentId: user.studentId, accountId: user.accountId || user.studentId || null, gender: user.gender || '', grade: user.grade || '', crossGrades: Array.isArray(user.crossGrades) ? user.crossGrades : [], department: user.department || '', major: user.major || '', position: user.role === 'teacher' ? normalizePosition(user.position) : '', positionRank: positionRankOf(user), active: user.active !== false,
    classIds: memberClasses.map(c => c.id),
    className: memberClasses.map(c => c.name || '').filter(Boolean).join('、'),
    classPath: memberClasses.map(c => [c.department, c.major, c.name].filter(Boolean).join(' › ')).filter(Boolean).join('；'),
    school: school ? { id: school.id, name: school.name, code: school.code, stage: school.stage || 'university' } : null,
    pendingSchool: pendingSchool ? { id: pendingSchool.id, name: pendingSchool.name, code: pendingSchool.code } : null,
    avatarUrl: user.avatarFile ? '/api/profile/avatar/' + encodeURIComponent(user.id) : '' };
}
function requireUser(user) { if (!user) fail(401, 'Please sign in first'); return user; }
function requireRole(user, role) { requireUser(user); if (user.role !== role) fail(403, 'You do not have permission to perform this action'); return user; }
function requireAdmin(user) { return requireRole(user, 'admin'); }
function isGlobalAdmin(user) { return user?.role === 'admin' && (user.adminScope === 'global' || !user.schoolId); }
function canAdminManage(admin, target) { return isGlobalAdmin(admin) || Boolean(admin?.schoolId && target?.schoolId === admin.schoolId); }
function invalidateSessions(userId) { for (const [key, session] of sessions) if (session.userId === userId) sessions.delete(key); }
function courseById(courseId) { const course = db.courses.find(c => c.id === courseId); if (!course) fail(404, 'Course not found'); return course; }
function quizByCourse(courseId) { return db.quizzes.find(q => q.courseId === courseId) || null; }
function lessonQuizByLesson(lessonId) { return (db.lessonQuizzes || []).find(q => q.lessonId === lessonId) || null; }
function validateLessonQuiz(body) {
  const questions = body?.questions;
  if (!Array.isArray(questions) || questions.length === 0 || questions.length > 1000) fail(400, 'Lesson quiz must contain 1–1000 questions');
  const seen = new Set();
  const mapped = questions.map((q, index) => {
    const text = safeText(q?.text, 'Question', 1000);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) fail(400, 'Each question must have 2–6 options');
    const options = q.options.map(o => safeText(o, 'Option', 500));
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= options.length) fail(400, 'Invalid correct-answer index');
    const setIndex = Number(q.setIndex ?? q.studentSet ?? 1);
    if (!Number.isInteger(setIndex) || setIndex < 1 || setIndex > 25) fail(400, 'Question set index must be between 1 and 25');
    const points = Number(q.points ?? 0.5);
    if (!Number.isFinite(points) || points <= 0 || points > 10) fail(400, 'Question points must be between 0 and 10');
    const qid = typeof q.id === 'string' && q.id.length < 100 ? q.id : id('lquestion');
    if (seen.has(qid)) fail(400, 'Question IDs must be unique');
    seen.add(qid);
    return { id: qid, text, options, correctIndex: q.correctIndex, setIndex, points };
  });
  const counts = {};
  for (const q of mapped) counts[q.setIndex] = (counts[q.setIndex] || 0) + 1;
  for (let setIndex = 1; setIndex <= 25; setIndex += 1) {
    if ((counts[setIndex] || 0) !== 20) fail(400, `Student set ${setIndex} must contain exactly 20 questions`);
  }
  const maxPoints = Number(body.maxPoints ?? 10);
  if (!Number.isFinite(maxPoints) || maxPoints <= 0 || maxPoints > 100) fail(400, 'Lesson quiz maximum points must be between 0 and 100');
  const title = safeText(body.title ?? '', 'Lesson quiz title', 150, false) || 'Lesson Check';
  return { title, maxPoints, questions: mapped };
}
function serializeLessonQuiz(quiz, user, setIndex) {
  if (!quiz) return null;
  const teacher = ['teacher', 'admin'].includes(user?.role);
  const questions = teacher ? quiz.questions : quiz.questions.filter(q => q.setIndex === setIndex);
  return {
    id: quiz.id, courseId: quiz.courseId, lessonId: quiz.lessonId, title: quiz.title,
    maxPoints: quiz.maxPoints, totalQuestions: questions.length, updatedAt: quiz.updatedAt,
    questions: questions.map(q => teacher ? { ...q } : { id: q.id, text: q.text, options: q.options, points: q.points })
  };
}
function quizSetFor(user, course) {
  const enrolled = enrollment(user.id, course.id);
  if (!enrolled) fail(403, 'Enroll in the course first');
  if (Number.isInteger(enrolled.quizSetIndex) && enrolled.quizSetIndex >= 1 && enrolled.quizSetIndex <= 25) return enrolled.quizSetIndex;
  const used = new Set(db.enrollments.filter(e => e.courseId === course.id && Number.isInteger(e.quizSetIndex)).map(e => e.quizSetIndex));
  let chosen = 0;
  for (let i = 1; i <= 25; i += 1) if (!used.has(i)) { chosen = i; break; }
  if (!chosen) fail(400, '本题库最多支持25名学生；如需更多学生，请先扩充题库');
  enrolled.quizSetIndex = chosen;
  save();
  return chosen;
}
function lessonQuizScoreFor(course, userId) {
  const quizzes = (db.lessonQuizzes || []).filter(q => q.courseId === course.id);
  if (!quizzes.length) return null;
  let total = 0;
  let any = false;
  for (const quiz of quizzes) {
    const attempts = (db.lessonQuizAttempts || []).filter(a => a.quizId === quiz.id && a.userId === userId);
    if (!attempts.length) continue;
    any = true;
    total += Math.max(...attempts.map(a => a.percent)) / 100 * Number(quiz.maxPoints || 10);
  }
  return any ? Math.min(100, Math.round(total * 100) / 100) : null;
}
function enrollment(userId, courseId) { return db.enrollments.find(e => e.userId === userId && e.courseId === courseId); }
function courseTeacherIds(course) {
  const list = Array.isArray(course?.teacherIds) ? course.teacherIds.filter(Boolean) : [];
  if (course?.teacherId && !list.includes(course.teacherId)) list.unshift(course.teacherId);
  return list;
}
function isCourseTeacher(user, course) {
  return Boolean(user && user.role === 'teacher' && courseTeacherIds(course).includes(user.id));
}
function canManageCourse(user, course) {
  if (!user || !course) return false;
  if (user.role === 'teacher') {
    if (isCourseTeacher(user, course)) return true;
    const pos = normalizePosition(user.position);
    if (['校长', '副校长', '教务处长', '院长', '副院长', '课题组长'].includes(pos)) {
      return visibleCoursesForTeacher(user).some(c => c.id === course.id);
    }
    return false;
  }
  if (user.role === 'admin') {
    if (isGlobalAdmin(user)) return true;
    const teachers = courseTeacherIds(course).map(tid => db.users.find(u => u.id === tid)).filter(Boolean);
    return Boolean((user.schoolId && course.schoolId === user.schoolId) || teachers.some(t => canAdminManage(user, t)));
  }
  return false;
}
function ownedCourse(user, course) {
  requireUser(user);
  if (!canManageCourse(user, course)) fail(403, 'You can only manage courses in your own workspace');
  return course;
}
function courseByLesson(lessonId) {
  const course = db.courses.find(c => c.lessons.some(l => l.id === lessonId));
  if (!course) fail(404, 'Lesson not found');
  return { course, lesson: course.lessons.find(l => l.id === lessonId) };
}
function folderById(lesson, folderId) {
  const folder = (lesson.resourceFolders || []).find(f => f.id === folderId);
  if (!folder) fail(404, 'Folder not found');
  return folder;
}
function publicFolder(folder) { return { id: folder.id, name: folder.name, files: (folder.files || []).map(f => ({ id: f.id, name: f.name, size: f.size, mimeType: f.mimeType })) }; }
function publicFolders(lesson) { return (lesson.resourceFolders || []).map(publicFolder); }
function canStudy(user, course) { requireUser(user); if (['teacher', 'admin'].includes(user.role)) return ownedCourse(user, course); if (!enrollment(user.id, course.id)) fail(403, 'Enroll in the course first'); return course; }
function progressFor(userId, course) {
  const enrolled = enrollment(userId, course.id);
  const completed = enrolled ? enrolled.completedLessonIds.filter(lessonId => course.lessons.some(l => l.id === lessonId)) : [];
  return { enrolled: Boolean(enrolled), completedLessonIds: completed, progress: course.lessons.length ? Math.round(completed.length / course.lessons.length * 100) : 0 };
}
function serializeCourse(course, user) {
  const tIds = courseTeacherIds(course);
  const teachers = tIds.map(tid => db.users.find(u => u.id === tid)).filter(Boolean);
  const teacherNames = teachers.map(t => t.name).join(', ') || 'Instructor';
  const p = user && user.role === 'student' ? progressFor(user.id, course) : { enrolled: false, completedLessonIds: [], progress: 0 };
  const canSeeLessonContent = Boolean(user && ((user.role === 'student' && p.enrolled) || canManageCourse(user, course)));
  const lessons = [...course.lessons].sort((a, b) => a.order - b.order).map(lesson =>
    canSeeLessonContent
      ? { ...lesson, videoFile: undefined, videoFileUrl: lesson.videoFile ? '/api/lessons/' + lesson.id + '/video' : '', files: (lesson.files || []).map(publicAttachment) }
      : { ...lesson, content: '', videoUrl: '', videoFile: undefined, videoFileUrl: '', files: [] });
  const { enrollmentCode, ...publicCourse } = course;
  const files = canSeeLessonContent ? (course.files || []).map(publicAttachment) : [];
  const announcements = canSeeLessonContent ? (course.announcements || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) : [];
  const oversight = canManageCourse(user, course);
  return { ...publicCourse, files, teacherIds: tIds, canOversight: oversight, ...(oversight ? { enrollmentCode } : {}), teacherName: teacherNames, lessons, announcements, ...p,
    studentCount: db.enrollments.filter(e => e.courseId === course.id).length, quizAvailable: Boolean(quizByCourse(course.id)?.questions.length) };
}
function ensureCourseChatRoom(course) {
  if (!Array.isArray(db.posts)) db.posts = [];
  if (!db.posts.some(p => p.courseId === course.id && p.authorRole === 'system')) {
    db.posts.unshift({
      id: id('post'),
      courseId: course.id,
      authorId: 'system',
      authorName: '班级群助手',
      authorRole: 'system',
      content: `🎉 欢迎加入《${course.title}》课程班级群！老师和同学们可以在这里随时发起讨论、提问答疑。`,
      createdAt: now()
    });
  }
}
function recentActivity(kind, userId, courseId, detail) {
  db.activity.unshift({ id: id('activity'), kind, userId, courseId, detail, createdAt: now() });
  db.activity = db.activity.slice(0, 100);
}
function safeText(value, label, max, required = true) {
  if (typeof value !== 'string') { if (!required && value == null) return ''; fail(400, `${label} has an invalid format`); }
  const text = value.trim();
  if (required && !text) fail(400, `${label} is required`);
  if (text.length > max) fail(400, `${label} must be no longer than ${max} characters`);
  return text;
}
function normalizeSchoolName(value) { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }
function schoolCodeExists(code) { return db.schools.some(school => school.code.toUpperCase() === code.toUpperCase()); }
function schoolCode() {
  let code;
  do { code = crypto.randomBytes(4).toString('hex').toUpperCase(); } while (schoolCodeExists(code));
  return code;
}
function resolveSchool(identifier) {
  const value = safeText(identifier ?? '', 'School code or name', 100, false);
  if (!value) return null;
  const byCode = db.schools.find(school => school.code.toUpperCase() === value.toUpperCase());
  if (byCode) return byCode;
  const matches = db.schools.filter(school => normalizeSchoolName(school.name) === normalizeSchoolName(value));
  if (matches.length > 1) fail(409, 'More than one school has this name. Use its school code instead.');
  if (!matches.length) fail(404, 'School not found. Check the school code or exact school name.');
  return matches[0];
}
function resolveSchoolFields(body) {
  const identifiers = [body.school, body.schoolCode, body.schoolName]
    .filter(value => value != null && !(typeof value === 'string' && !value.trim()));
  const matches = identifiers.map(resolveSchool);
  if (new Set(matches.map(school => school.id)).size > 1) fail(400, 'School code and school name refer to different organizations');
  return matches[0] || null;
}
function courseCodePrefix(context = {}) {
  const dept = String(context.targetDepartments?.[0] || context.department || context.teacherDepartment || '').trim();
  if (dept) {
    for (const [name, prefix] of Object.entries(DEPARTMENT_CODE_PREFIXES)) {
      if (dept.includes(name.trim())) return prefix;
    }
    const first = Array.from(dept)[0];
    if (/[A-Za-z]/.test(first)) return first.toUpperCase();
  }
  return 'C';
}
function reserveCourseCode(code) {
  if (!Array.isArray(db.usedCourseCodes)) db.usedCourseCodes = [];
  if (!db.usedCourseCodes.includes(code)) db.usedCourseCodes.push(code);
}
function newCourseEnrollmentCode(courses, context = {}) {
  const prefix = courseCodePrefix(context);
  let code;
  do {
    code = prefix + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 5);
  } while (courses.some(c => String(c.enrollmentCode || '').toUpperCase() === code) || (db.usedCourseCodes || []).includes(code));
  reserveCourseCode(code);
  return code;
}
const AUTO_COVER_RULES = Object.freeze([
  [/语文|中文|文学|Chinese|Literature/i, '📖', '#b45309'],
  [/数学|Math/i, '📐', '#2563eb'],
  [/英语|外语|English/i, '🔤', '#7c3aed'],
  [/物理|化学|生物|实验|Science|Lab/i, '🧪', '#0f766e'],
  [/计算机|信息|编程|Python|Digital|Code/i, '💻', '#1d4ed8'],
  [/体育|运动|PE|Sport/i, '⚽', '#16a34a'],
  [/音乐|Music/i, '🎵', '#db2777'],
  [/美术|艺术|Art/i, '🎨', '#ea580c'],
  [/历史|History/i, '🏛️', '#92400e'],
  [/地理|Geo/i, '🌍', '#0891b2'],
]);
function autoCourseCover(title = '', category = '') {
  const text = `${title} ${category}`;
  for (const [pattern, cover, color] of AUTO_COVER_RULES) {
    if (pattern.test(text)) return { cover, color };
  }
  return { cover: '📘', color: '#6979dc' };
}
function courseFields(body, existing = null) {
  const next = {};
  for (const [key, label, max, required] of [['title','Course title',100,true],['description','Course description',2000,true],['category','Course category',40,true],['cover','Cover type',80,false],['color','Theme color',16,false]]) {
    if (body[key] !== undefined || !existing) next[key] = safeText(body[key] ?? (required ? '' : ''), label, max, required);
  }
  if (!existing) {
    const autoCover = autoCourseCover(next.title || '', next.category || '');
    if (!next.cover) next.cover = autoCover.cover;
    if (!next.color) next.color = autoCover.color;
  }
  if (next.color && !/^#[0-9a-fA-F]{6}$/.test(next.color)) fail(400, 'Theme color must use #RRGGBB format');
  if (body.academicYear !== undefined || !existing) next.academicYear = safeText(body.academicYear ?? '', 'Academic year', 40, false);
  if (body.ownerDepartment !== undefined || !existing) next.ownerDepartment = safeText(body.ownerDepartment ?? '', 'Owner department', 80, false);
  if (body.courseType !== undefined || !existing) {
    const courseType = String(body.courseType || 'online').toLowerCase();
    next.courseType = ['online', 'normal'].includes(courseType) ? courseType : fail(400, 'Course type must be online or normal');
  }
  if (body.coverImage !== undefined) {
    const image = String(body.coverImage || '');
    if (image && (!/^data:image\/[a-zA-Z0-9+.-]+;base64,/.test(image) || image.length > 3 * 1024 * 1024)) fail(400, 'Cover image must be a data URL under 3 MB');
    next.coverImage = image;
  }
  for (const key of ['targetDepartments', 'targetMajors']) {
    if (body[key] !== undefined || !existing) next[key] = normalizeListValue(body[key], key, 80);
  }
  if (body.targetClassIds !== undefined || !existing) next.targetClassIds = normalizeIdList(body.targetClassIds, 'Class ID');
  if (body.autoEnroll !== undefined || !existing) next.autoEnroll = Boolean(body.autoEnroll);
  if (body.enrollmentCode !== undefined) {
    const code = safeText(body.enrollmentCode, 'Enrollment code', 20).toUpperCase();
    if (!/^[A-Z0-9-]{4,20}$/.test(code)) fail(400, 'Enrollment code must contain 4–20 letters, numbers, or hyphens');
    if (db.courses.some(course => course.id !== existing?.id && course.enrollmentCode?.toUpperCase() === code)) fail(409, 'This enrollment code is already used by another course');
    next.enrollmentCode = code;
    reserveCourseCode(code);
  } else if (!existing) next.enrollmentCode = newCourseEnrollmentCode(db.courses, body);
  return next;
}
function normalizeListValue(value, label, max = 80) {
  const raw = Array.isArray(value) ? value : (typeof value === 'string' && value.trim() ? value.split(/[,，;；]/) : []);
  return [...new Set(raw.map(item => safeText(String(item ?? ''), label, max, false)).filter(Boolean))];
}
function normalizeIdList(value, label = 'ID', max = 300) {
  const raw = Array.isArray(value) ? value : (typeof value === 'string' && value.trim() ? value.split(/[,，;；]/) : []);
  return [...new Set(raw.map(item => safeText(String(item ?? ''), label, 80, false)).filter(Boolean))].slice(0, max);
}
function classesForAdmin(user) {
  return (db.studentClasses || []).filter(c => isGlobalAdmin(user) || c.schoolId === user.schoolId);
}
function publicStudentClass(c) {
  const students = (c.studentIds || []).map(sid => db.users.find(u => u.id === sid && u.role === 'student' && u.active !== false)).filter(Boolean);
  return {
    id: c.id, schoolId: c.schoolId || null, name: c.name,
    grade: c.grade || '', department: c.department || '', major: c.major || '', academicYear: c.academicYear || '',
    path: [c.department, c.major, c.name].filter(Boolean).join(' › '),
    studentIds: students.map(s => s.id),
    students: students.map(s => ({ id: s.id, name: s.name, studentId: s.studentId || '', accountId: s.accountId || '', email: s.email, department: s.department || '', major: s.major || '', grade: s.grade || '' })),
    studentCount: students.length, createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}
function findManagedClass(user, classId) {
  const cls = (db.studentClasses || []).find(c => c.id === classId);
  if (!cls || (!isGlobalAdmin(user) && cls.schoolId !== user.schoolId)) fail(404, 'Class not found');
  return cls;
}
function findOrCreateClassForStudents(meta, studentIds, adminUser) {
  const schoolId = meta.schoolId ?? (isGlobalAdmin(adminUser) ? null : adminUser.schoolId);
  const name = String(meta.name || '').trim();
  if (!name) fail(400, 'Class name is required');
  let cls = (db.studentClasses || []).find(c => c.schoolId === schoolId && c.name.toLowerCase() === name.toLowerCase()
    && (c.department || '') === (meta.department || '') && (c.major || '') === (meta.major || '')
    && (c.grade || '') === (meta.grade || ''));
  if (!cls) {
    cls = { id: id('class'), schoolId, name, grade: meta.grade || '', department: meta.department || '', major: meta.major || '',
      academicYear: meta.academicYear || '', studentIds: [], createdAt: now(), updatedAt: now() };
    db.studentClasses.push(cls);
  }
  const set = new Set(cls.studentIds || []);
  for (const sid of studentIds) set.add(sid);
  cls.studentIds = [...set];
  cls.updatedAt = now();
  return cls;
}
function assignStudentsToClass(adminUser, studentIds, meta) {
  const students = resolveStudents(adminUser, studentIds);
  const ids = students.map(s => s.id);
  for (const existing of (db.studentClasses || [])) {
    existing.studentIds = (existing.studentIds || []).filter(sid => !ids.includes(sid));
  }
  const cls = findOrCreateClassForStudents(meta, ids, adminUser);
  return cls;
}
function resolveClassStudents(user, classIds) {
  const ids = normalizeIdList(classIds, 'Class ID');
  const classes = ids.map(cid => findManagedClass(user, cid));
  const byId = new Map();
  for (const cls of classes) {
    for (const sid of (cls.studentIds || [])) {
      const student = db.users.find(u => u.id === sid && u.role === 'student' && u.active !== false);
      if (student && canAdminManage(user, student)) byId.set(student.id, student);
    }
  }
  return { classes, students: [...byId.values()] };
}
function resolveStudents(user, ids) {
  const list = normalizeIdList(ids, 'Student ID');
  const students = [];
  for (const sid of list) {
    const student = db.users.find(u => u.id === sid && u.role === 'student' && u.active !== false);
    if (!student || !canAdminManage(user, student)) fail(400, 'Selected student is invalid or outside your school');
    students.push(student);
  }
  return students;
}
function enrollStudentsIntoCourse(course, students) {
  let count = 0;
  for (const student of students) {
    if (!student || student.role !== 'student' || student.active === false) continue;
    if (!enrollment(student.id, course.id)) {
      db.enrollments.push({ id: id('enrollment'), userId: student.id, courseId: course.id, completedLessonIds: [], createdAt: now(), lastActiveAt: now() });
      count += 1;
    }
  }
  return count;
}
function studentMatchesAudience(student, course) {
  const year = String(course.academicYear || '').trim();
  const studentYear = String(student.grade || student.academicYear || '').trim();
  if (year && studentYear !== year) return false;
  const departments = Array.isArray(course.targetDepartments) ? course.targetDepartments : [];
  if (departments.length && !departments.includes(String(student.department || '').trim())) return false;
  const majors = Array.isArray(course.targetMajors) ? course.targetMajors : [];
  if (majors.length && !majors.includes(String(student.major || '').trim())) return false;
  return true;
}
function autoEnrollStudents(course, students) {
  if (!course.autoEnroll) return 0;
  let count = 0;
  for (const student of students) {
    if (!student || student.role !== 'student' || student.active === false) continue;
    if (!studentMatchesAudience(student, course)) continue;
    if (!enrollment(student.id, course.id)) {
      db.enrollments.push({ id: id('enrollment'), userId: student.id, courseId: course.id, completedLessonIds: [], createdAt: now(), lastActiveAt: now() });
      count += 1;
    }
  }
  return count;
}
function autoEnrollIntoAllCourses(students) {
  let count = 0;
  for (const course of db.courses) count += autoEnrollStudents(course, students);
  return count;
}
function cloneCourseForAdmin(source) {
  const copy = { ...source, id: id('course'), title: String(source.title || 'Course') + '（副本）', enrollmentCode: newCourseEnrollmentCode(db.courses, source), lessons: [], createdAt: now(), updatedAt: now(), autoEnroll: false, targetClassIds: [] };
  delete copy.studentCount; delete copy.canOversight; delete copy.teacherName; delete copy.enrolledStudents;
  const lessonMap = new Map();
  for (const lesson of (source.lessons || [])) {
    const lessonCopy = JSON.parse(JSON.stringify(lesson));
    lessonCopy.id = id('lesson');
    lessonCopy.courseId = copy.id;
    lessonCopy.videoFile = undefined;
    lessonCopy.videoUrl = lesson.videoUrl || '';
    lessonCopy.files = [];
    lessonMap.set(lesson.id, lessonCopy.id);
    copy.lessons.push(lessonCopy);
  }
  db.courses.push(copy);
  ensureCourseChatRoom(copy);
  for (const quiz of db.quizzes.filter(q => q.courseId === source.id)) {
    const quizCopy = JSON.parse(JSON.stringify(quiz));
    quizCopy.id = id('quiz'); quizCopy.courseId = copy.id; quizCopy.createdAt = now(); quizCopy.updatedAt = now();
    db.quizzes.push(quizCopy);
  }
  for (const quiz of db.lessonQuizzes.filter(q => lessonMap.has(q.lessonId))) {
    const quizCopy = JSON.parse(JSON.stringify(quiz));
    quizCopy.id = id('lquiz'); quizCopy.lessonId = lessonMap.get(quiz.lessonId); quizCopy.updatedAt = now();
    db.lessonQuizzes.push(quizCopy);
  }
  for (const assignment of db.assignments.filter(a => a.courseId === source.id)) {
    const assignmentCopy = JSON.parse(JSON.stringify(assignment));
    assignmentCopy.id = id('asg'); assignmentCopy.courseId = copy.id; assignmentCopy.createdAt = now(); assignmentCopy.updatedAt = now();
    db.assignments.push(assignmentCopy);
  }
  for (const announcement of db.announcements.filter(a => a.courseId === source.id)) {
    const announcementCopy = JSON.parse(JSON.stringify(announcement));
    announcementCopy.id = id('ann'); announcementCopy.courseId = copy.id; announcementCopy.createdAt = now();
    db.announcements.push(announcementCopy);
  }
  return copy;
}
function lessonFields(body, existing = null) {
  const next = {};
  for (const [key, label, max, required] of [['title','Lesson title',120,true],['type','Lesson type',20,false],['duration','Lesson duration',30,false],['content','Lesson content',30000,false],['videoUrl','Video URL',1000,false]]) {
    if (body[key] !== undefined || !existing) next[key] = safeText(body[key] ?? '', label, max, required);
  }
  if (next.videoUrl && !/^https?:\/\//i.test(next.videoUrl)) fail(400, 'Video URL must start with http:// or https://');
  if (next.type && !['video', 'reading', 'assignment'].includes(next.type)) fail(400, 'Invalid lesson type');
  return next;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(new HttpError(413, 'Submitted content is too large')); req.destroy(); return; } chunks.push(chunk); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'Invalid submission format'); resolve(body); }
      catch (error) { reject(error instanceof HttpError ? error : new HttpError(400, 'Please submit valid JSON')); }
    });
    req.on('error', reject);
  });
}
function readBinary(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let tooLarge = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { tooLarge = true; return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) reject(new HttpError(413, 'Uploaded file is too large'));
      else if (!size) reject(new HttpError(400, 'Please choose a file'));
      else resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}
const MAX_GENERAL_FILE = 80 * 1024 * 1024;
const ALLOWED_GENERAL_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.txt', '.md', '.csv', '.rtf', '.wps', '.et', '.dps',
  '.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv',
  '.mp3', '.wav', '.m4a', '.aac', '.flac',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.py', '.js', '.ts', '.java', '.c', '.cpp', '.html', '.css', '.json', '.sql', '.ipynb'
]);
function validateGeneralFileUpload(req) {
  const originalName = cleanFileName(req);
  const dotIdx = originalName.lastIndexOf('.');
  const ext = dotIdx > 0 ? originalName.slice(dotIdx).toLowerCase() : '';
  if (!ext || !ALLOWED_GENERAL_EXTS.has(ext)) {
    fail(415, '不支持的文件格式：' + (ext || '无后缀') + '（支持 PDF、Word、PPT、Excel、音视频、图片、压缩包、代码等格式）');
  }
  return { originalName, ext };
}
function publicAttachment(att) {
  return { id: att.id, name: att.name, size: att.size, mimeType: att.mimeType, createdAt: att.createdAt };
}

function cleanFileName(req) {
  const raw = req.headers['x-file-name'];
  let decoded = Array.isArray(raw) ? raw[0] : (raw || 'File');
  try { decoded = decodeURIComponent(decoded); } catch {}
  return String(decoded).replace(/[\/\\\r\n\x00-\x1f]/g, '_').slice(0, 150) || 'File';
}
async function saveUpload(buffer, req, extension) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  const storedName = crypto.randomUUID() + extension;
  const mimeType = req.headers['content-type'].split(';')[0].trim().toLowerCase();
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buffer, { flag: 'wx', mode: 0o600 });
  if (storage.getConfig().enabled) {
    await storage.putObject(`uploads/${storedName}`, buffer, mimeType);
  }
  return { storedName, name: cleanFileName(req), mimeType, size: buffer.length };
}
function removeUpload(meta) {
  if (meta?.storedName && /^[0-9a-f-]{36}\.[a-z0-9]+$/.test(meta.storedName)) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, meta.storedName)); } catch {}
    if (storage.getConfig().enabled) {
      storage.deleteObject(`uploads/${meta.storedName}`).catch(() => {});
    }
  }
}
async function ensureLocalFile(storedName) {
  if (!storedName || !/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(storedName)) return null;
  const file = path.join(UPLOAD_DIR, storedName);
  if (fs.existsSync(file)) return file;
  if (!storage.getConfig().enabled) return file;
  const buf = await storage.getObject(`uploads/${storedName}`);
  if (!buf) return file;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, buf, { mode: 0o600 });
  return file;
}
async function streamUpload(req, res, meta, video = false) {
  if (!meta?.storedName || !/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(meta.storedName)) fail(404, 'File not found');
  const file = await ensureLocalFile(meta.storedName);
  let stat;
  try { stat = fs.statSync(file); } catch { fail(404, 'File not found'); }
  const headers = {
    'Content-Type': video ? meta.mimeType : 'application/octet-stream',
    'Content-Disposition': (video ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(meta.name || 'file'),
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Accept-Ranges': 'bytes'
  };
  const range = req.headers.range;
  if (video && range) {
    const match = String(range).match(/^bytes=(\d*)-(\d*)$/);
    if (!match) fail(416, 'Invalid video range');
    const start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2] || 0));
    const end = match[2] && match[1] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end >= stat.size) fail(416, 'Invalid video range');
    res.writeHead(206, { ...headers, 'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res); return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(file).pipe(res);
}
function validateQuiz(questions) {
  if (!Array.isArray(questions) || questions.length > 50) fail(400, 'Quiz questions must be an array of no more than 50 items');
  return questions.map(q => {
    const text = safeText(q?.text, 'Question', 1000);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) fail(400, 'Each question must have 2–6 options');
    const options = q.options.map(o => safeText(o, 'Option', 500));
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= options.length) fail(400, 'Invalid correct-answer index');
    return { id: typeof q.id === 'string' && q.id.length < 100 ? q.id : id('question'), text, options, correctIndex: q.correctIndex };
  });
}
function serializeQuiz(quiz, user) {
  if (!quiz) return null;
  return { ...quiz, questions: quiz.questions.map(q => ['teacher', 'admin'].includes(user?.role) ? { ...q } : { id: q.id, text: q.text, options: q.options }) };
}
function studentEnrollmentDetails(student, course) {
  const enrolled = enrollment(student.id, course.id);
  if (!enrolled) return null;
  const attempts = db.attempts.filter(a => a.userId === student.id && a.courseId === course.id);
  return { courseId: course.id, courseTitle: course.title, progress: progressFor(student.id, course).progress,
    completedLessons: enrolled.completedLessonIds.length, totalLessons: course.lessons.length, lastActiveAt: enrolled.lastActiveAt,
    bestQuizScore: attempts.length ? Math.max(...attempts.map(a => a.percent)) : null };
}

function assignmentById(assignmentId) {
  const assignment = db.assignments.find(a => a.id === assignmentId);
  if (!assignment) fail(404, 'Assignment not found');
  return assignment;
}
function assignmentFields(body, existing = null) {
  const fields = {};
  if (!existing || body.title !== undefined) fields.title = safeText(body.title, 'Assignment title', 150);
  if (!existing || body.instructions !== undefined) fields.instructions = safeText(body.instructions, 'Assignment instructions', 10000, false);
  if (!existing || body.dueAt !== undefined) {
    const dueAt = safeText(body.dueAt ?? '', 'Due date', 40, false);
    if (dueAt && Number.isNaN(Date.parse(dueAt))) fail(400, 'Invalid due date');
    fields.dueAt = dueAt ? new Date(dueAt).toISOString() : null;
  }
  if (!existing || body.maxScore !== undefined) {
    const score = Number(body.maxScore ?? 100);
    if (!Number.isFinite(score) || score <= 0 || score > 1000) fail(400, 'Maximum assignment score must be greater than 0 and no more than 1000');
    fields.maxScore = score;
  }
  return fields;
}
function serializeSubmission(submission) {
  if (!submission) return null;
  const student = db.users.find(u => u.id === submission.userId);
  return { id: submission.id, assignmentId: submission.assignmentId, userId: submission.userId,
    studentName: student?.name || 'Student', studentId: student?.studentId || '', content: submission.content,
    fileName: submission.file?.name || '', fileUrl: submission.file ? '/api/submissions/' + submission.id + '/file' : '',
    score: submission.score ?? null, feedback: submission.feedback || '', submittedAt: submission.submittedAt, gradedAt: submission.gradedAt || null };
}
function serializeAssignment(assignment, user) {
  const submissions = db.submissions.filter(s => s.assignmentId === assignment.id);
  const stats = { submitted: submissions.length, graded: submissions.filter(s => s.score != null).length,
    totalStudents: db.enrollments.filter(e => e.courseId === assignment.courseId).length };
  return { ...assignment, ...(['teacher', 'admin'].includes(user.role) ? { stats } : { submission: serializeSubmission(submissions.find(s => s.userId === user.id)) }) };
}
function validateWeights(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Please set grade weights');
  const weights = {};
  for (const key of GRADE_KEYS) {
    const value = Number(input[key]);
    if (!Number.isFinite(value) || value < 0 || value > 100) fail(400, 'Each grade weight must be between 0 and 100');
    weights[key] = value;
  }
  if (Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 100) > 0.000001) fail(400, 'Grade weights must total 100%');
  return weights;
}
function gradeFor(course, userId) {
  const weights = course.gradeWeights || DEFAULT_WEIGHTS;
  const manual = db.grades.find(g => g.courseId === course.id && g.userId === userId)?.scores || {};
  const graded = db.assignments.filter(a => a.courseId === course.id).flatMap(a => db.submissions.filter(s => s.assignmentId === a.id && s.userId === userId && s.score != null).map(s => s.score / a.maxScore * 100));
  const assignmentAverage = graded.length ? Math.round(graded.reduce((sum, score) => sum + score, 0) / graded.length * 100) / 100 : null;
  const attempts = db.attempts.filter(a => a.courseId === course.id && a.userId === userId);
  const lessonQuizScore = lessonQuizScoreFor(course, userId);
  const quizBest = lessonQuizScore ?? (attempts.length ? Math.max(...attempts.map(a => a.percent)) : null);
  const scores = {}, sources = {};
  for (const key of GRADE_KEYS) {
    const automatic = key === 'usual' ? assignmentAverage : key === 'quiz' ? quizBest : null;
    scores[key] = manual[key] ?? automatic;
    sources[key] = manual[key] != null ? 'teacher' : automatic != null ? (key === 'usual' ? 'assignments' : lessonQuizScore != null ? 'lesson-quizzes' : 'quiz') : 'pending';
  }
  const complete = GRADE_KEYS.every(key => !weights[key] || scores[key] != null);
  const total = complete ? Math.round(GRADE_KEYS.reduce((sum, key) => sum + (scores[key] ?? 0) * weights[key] / 100, 0) * 100) / 100 : null;
  return { weights, scores, sources, total, assignmentAverage, quizBest, lessonQuizScore };
}
function publishedGradeFor(course, userId) {
  const weights = course.gradeWeights || DEFAULT_WEIGHTS;
  const pub = course.gradePublication;
  if (pub && pub.status === 'draft') {
    return { weights, scores: {}, sources: {}, total: null, status: 'draft', publishedAt: null };
  }
  if (pub && Array.isArray(pub.snapshot)) {
    const item = pub.snapshot.find(x => x && x.userId === userId);
    if (item) return { weights: item.weights || weights, scores: item.scores || {}, sources: item.sources || {}, total: item.total ?? null, status: 'published', publishedAt: pub.publishedAt || null };
  }
  return { ...gradeFor(course, userId), status: 'published', publishedAt: pub?.publishedAt || null };
}
function publicGradePublication(course) {
  const pub = course.gradePublication || { status: 'published', publishedAt: null, publishedBy: null, snapshot: null };
  return { status: pub.status || 'published', publishedAt: pub.publishedAt || null, publishedBy: pub.publishedBy || null, studentCount: Array.isArray(pub.snapshot) ? pub.snapshot.length : 0 };
}
function studentGradeDetails(course, userId) {
  const classmates = db.enrollments.filter(e => e.courseId === course.id && db.users.some(u => u.id === e.userId && u.role === 'student' && u.active !== false));
  const ownTotal = gradeFor(course, userId).total;
  const rank = ownTotal == null ? null : 1 + classmates.filter(e => { const total = gradeFor(course, e.userId).total; return total != null && total > ownTotal; }).length;
  const assignments = db.assignments.filter(a => a.courseId === course.id).flatMap(assignment => {
    const submission = db.submissions.find(s => s.assignmentId === assignment.id && s.userId === userId);
    if (!submission) return [];
    return [...(submission.history || []), submission].map(s => ({ id: assignment.id, title: assignment.title, maxScore: assignment.maxScore, score: s.score ?? null, feedback: s.feedback || '', submittedAt: s.submittedAt, gradedAt: s.gradedAt || null }));
  }).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  const quizTitle = quizByCourse(course.id)?.title || 'Course Quiz';
  const quizAttempts = db.attempts.filter(a => a.courseId === course.id && a.userId === userId).map(a => ({ id: a.id, title: quizTitle, score: a.score, total: a.total, percent: a.percent, submittedAt: a.submittedAt })).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  const lessonQuizAttempts = (db.lessonQuizAttempts || []).filter(a => a.courseId === course.id && a.userId === userId).map(a => {
    const lesson = course.lessons.find(l => l.id === a.lessonId);
    return { id: a.id, title: lesson?.title || 'Lesson Check', score: a.score, total: a.total, percent: a.percent, points: a.score, lessonId: a.lessonId, submittedAt: a.submittedAt };
  }).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  return { classSize: classmates.length, rank, assignments, quizAttempts: [...lessonQuizAttempts, ...quizAttempts], lessonQuizAttempts };
}

async function api(req, res, url) {
  await readyPromise;
  const method = req.method;
  const pathname = url.pathname;
  const user = getUser(req);
  const isBinary = pathname === '/api/profile/avatar' || /^\/api\/lessons\/[^/]+\/video$/.test(pathname) || /^\/api\/lessons\/[^/]+\/files$/.test(pathname) || /^\/api\/courses\/[^/]+\/files$/.test(pathname) || /^\/api\/assignments\/[^/]+\/submission\/file$/.test(pathname) || /^\/api\/lessons\/[^/]+\/folders\/[^/]+\/files$/.test(pathname);
  const body = ['POST','PATCH','PUT'].includes(method) && !isBinary ? await readBody(req) : {};
  if (pathname === '/api/health' && method === 'GET') return json(res, 200, { ok: true });
  if (pathname === '/api/auth/me' && method === 'GET') return json(res, 200, { user: publicUser(user) });
  if (pathname === '/api/profile' && method === 'GET') return json(res, 200, { profile: publicUser(requireUser(user)) });
  if (pathname === '/api/profile' && method === 'PATCH') {
    requireUser(user);
    if (Object.keys(body).some(key => !['name', 'gender', 'grade'].includes(key))) fail(400, 'Account ID, student ID, email, and account role cannot be changed');
    const next = {};
    if (body.name !== undefined) next.name = safeText(body.name, 'Name', 60);
    if (body.gender !== undefined) {
      const gender = safeText(body.gender, 'Gender', 30, false);
      // Retain the legacy values already stored for existing profiles.
      if (!['', 'Male', 'Female', 'Other', 'Prefer not to say', '\u7537', '\u5973', '\u5176\u4ed6', '\u4e0d\u4fbf\u900f\u9732'].includes(gender)) fail(400, 'Invalid gender option');
      next.gender = gender;
    }
    if (body.grade !== undefined) next.grade = safeText(body.grade, 'Grade', 30, false);
    Object.assign(user, next);
    save();
    return json(res, 200, { profile: publicUser(user) });
  }
  if (pathname === '/api/profile/organization' && method === 'POST') {
    requireUser(user);
    if (!['student', 'teacher'].includes(user.role)) fail(403, 'Only student and teacher accounts can join a school');
    if (user.schoolId) fail(409, 'This account is already linked to a school');
    const school = resolveSchoolFields(body);
    if (!school) fail(400, 'Enter a school code or exact school name');
    if (user.role === 'teacher') {
      user.pendingSchoolId = school.id;
      user.pendingSchoolRequestedAt = now();
    } else {
      user.schoolId = school.id;
    }
    save();
    return json(res, 200, { profile: publicUser(user) });
  }
  if (pathname === '/api/profile/avatar' && method === 'POST') {
    requireUser(user);
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const allowed = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
    const extension = allowed[mime];
    if (!extension) fail(415, 'Only PNG, JPEG, or WebP avatars are supported');
    const buffer = await readBinary(req, MAX_AVATAR);
    const valid = mime === 'image/png' ? buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : mime === 'image/jpeg' ? buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) fail(415, 'The avatar file does not match its image format');
    const previous = user.avatarFile;
    const uploaded = await saveUpload(buffer, req, extension);
    user.avatarFile = uploaded;
    try { save(); } catch (error) { user.avatarFile = previous; removeUpload(uploaded); throw error; }
    removeUpload(previous);
    return json(res, 200, { profile: publicUser(user) });
  }
  const avatarMatch = pathname.match(/^\/api\/profile\/avatar\/([^/]+)$/);
  if (avatarMatch && method === 'GET') {
    requireUser(user);
    if (avatarMatch[1] !== user.id) fail(403, 'You cannot view another user’s avatar');
    const meta = user.avatarFile;
    if (!meta?.storedName || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(meta.storedName)) fail(404, 'Avatar not found');
    const file = await ensureLocalFile(meta.storedName);
    let stat;
    try { stat = fs.statSync(file); } catch { fail(404, 'Avatar not found'); }
    res.writeHead(200, { 'Content-Type': meta.mimeType, 'Content-Length': stat.size, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  function accountIdTaken(value) {
    const key = String(value || '').toLowerCase();
    return Boolean(key && db.users.some(u => u.accountId?.toLowerCase() === key || u.studentId?.toLowerCase() === key));
  }
  function validateRoleAccountId(role, raw) {
    const label = role === 'student' ? 'Student Account ID' : role === 'teacher' ? 'Instructor Account ID' : 'Administrator Account ID';
    const value = safeText(raw, label, 32);
    if (role === 'student') {
      if (!/^\d{4,32}$/.test(value)) fail(400, 'Student account ID must contain only digits (4–32 digits)');
      return value;
    }
    const normalized = value.toLowerCase();
    if (role === 'teacher') {
      if (!/^tch\d{2,24}$/.test(normalized)) fail(400, 'Instructor account ID must start with tch followed by digits (e.g. tch202601)');
      return normalized;
    }
    if (role === 'admin') {
      const upper = value.toUpperCase();
      if (!/^[A-Z][A-Z0-9]{2,31}$/.test(upper)) fail(400, 'Administrator account ID must start with an English letter and use uppercase letters and digits (e.g. SIU199901)');
      return upper;
    }
    fail(400, 'Invalid account role');
  }
  if (pathname === '/api/auth/register' && method === 'POST') {
    const name = safeText(body.name, 'Name', 60);
    const email = safeText(body.email, 'Email', 254).toLowerCase();
    const role = body.role === undefined ? 'student' : body.role;
    if (!['student', 'teacher'].includes(role)) fail(400, 'Invalid account role');
    if (role === 'teacher' && body.studentId != null && body.studentId !== '') fail(400, 'Teacher accounts do not need a student ID');
    const accountId = validateRoleAccountId(role, role === 'student' ? (body.accountId ?? body.studentId) : body.accountId);
    const studentId = role === 'student' ? accountId : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) fail(400, 'Password must contain 8–128 characters');
    if (db.users.some(u => u.email.toLowerCase() === email)) fail(409, 'This email is already registered');
    if (accountIdTaken(accountId)) fail(409, role === 'student' ? 'This student ID is already registered; each student can have only one account' : 'This account ID is already registered');
    const school = resolveSchoolFields(body);
    const newUser = {
      id: id('user'), role, name, email, studentId, accountId,
      schoolId: role === 'teacher' ? null : (school?.id || null),
      ...(role === 'teacher' ? { grade: safeText(body.grade ?? '', 'Grade', 40, false), crossGrades: normalizeListValue(body.crossGrades ?? [], 'Cross grade', 40) } : {}),
      ...(role === 'teacher' && school ? { pendingSchoolId: school.id, pendingSchoolRequestedAt: now() } : {}),
      passwordHash: hashPassword(body.password), createdAt: now()
    };
    db.users.push(newUser); save();
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(crypto.createHash('sha256').update(token).digest('hex'), { userId: newUser.id, expiresAt: Date.now() + SESSION_MS });
    return json(res, 201, { user: publicUser(newUser) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_MS / 1000) });
  }
  if (pathname === '/api/auth/register-admin' && method === 'POST') {
    const name = safeText(body.name, 'Name', 60);
    const email = safeText(body.email, 'Email', 254).toLowerCase();
    const accountId = validateRoleAccountId('admin', body.accountId);
    const schoolName = safeText(body.schoolName, 'School name', 100);
    const stage = SCHOOL_STAGES[body.stage] ? body.stage : 'university';
    const requestedCode = safeText(body.schoolCode ?? '', 'School code', 16, false).toUpperCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) fail(400, 'Password must contain 8–128 characters');
    if (db.users.some(u => u.email.toLowerCase() === email)) fail(409, 'This email is already registered');
    if (accountIdTaken(accountId)) fail(409, 'This account ID is already registered');
    if (db.schools.some(school => normalizeSchoolName(school.name) === normalizeSchoolName(schoolName))) fail(409, 'This school already has an organization. Sign in with its administrator account or contact the site administrator.');
    if (requestedCode && !/^[A-Z0-9_-]{4,16}$/.test(requestedCode)) fail(400, 'School code must contain 4–16 letters, numbers, underscores, or hyphens');
    const code = requestedCode || schoolCode();
    if (schoolCodeExists(code)) fail(409, 'This school code is already in use');
    const school = { id: id('school'), name: schoolName, code, stage, createdAt: now() };
    const newUser = { id: id('user'), role: 'admin', adminScope: 'school', schoolId: school.id, name, email, studentId: null, accountId, passwordHash: hashPassword(body.password), active: true, createdAt: now() };
    db.schools.push(school);
    db.users.push(newUser);
    try { save(); } catch (error) { db.schools.pop(); db.users.pop(); throw error; }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(crypto.createHash('sha256').update(token).digest('hex'), { userId: newUser.id, expiresAt: Date.now() + SESSION_MS });
    return json(res, 201, { user: publicUser(newUser) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_MS / 1000) });
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    const identifier = safeText(body.identifier ?? body.account ?? body.email, 'Account ID or Email', 254).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const bucket = `${req.socket.remoteAddress || ''}:${identifier}`;
    const failure = loginFailures.get(bucket);
    if (failure && failure.until > Date.now() && failure.count >= 8) fail(429, 'Too many login attempts. Please try again later');
    const found = db.users.find(u => u.active !== false && (
      u.email.toLowerCase() === identifier ||
      (u.accountId && u.accountId.toLowerCase() === identifier) ||
      (u.studentId && u.studentId.toLowerCase() === identifier)
    ));
    if (!found || !checkPassword(password, found.passwordHash)) {
      loginFailures.set(bucket, { count: (failure?.until > Date.now() ? failure.count : 0) + 1, until: Date.now() + 15 * 60_000 });
      fail(401, 'Incorrect account ID/email or password');
    }
    loginFailures.delete(bucket);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(crypto.createHash('sha256').update(token).digest('hex'), { userId: found.id, expiresAt: Date.now() + SESSION_MS });
    return json(res, 200, { user: publicUser(found) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_MS / 1000) });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('lms_session='));
    if (cookie) sessions.delete(crypto.createHash('sha256').update(cookie.slice('lms_session='.length)).digest('hex'));
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (pathname === '/api/auth/forgot-password' && method === 'POST') {
    const email = safeText(body.email, 'Email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address');
    if (!resetMail.configured()) fail(503, 'Password reset by email is unavailable. Contact the site administrator.');
    const bucket = `${req.socket.remoteAddress || ''}:${email}`;
    const last = resetAttempts.get(bucket) || 0;
    if (Date.now() - last < 60_000) fail(429, 'Please wait before requesting another reset email');
    resetAttempts.set(bucket, Date.now());
    const target = db.users.find(u => u.email.toLowerCase() === email && u.active !== false);
    if (target) {
      const token = crypto.randomBytes(32).toString('hex');
      const key = crypto.createHash('sha256').update(token).digest('hex');
      // Mail must be accepted before storing an active token. Never return it in HTTP.
      try {
        await resetMail.sendResetEmail(email, token);
        for (const [oldKey, entry] of resetTokens) if (entry.userId === target.id) resetTokens.delete(oldKey);
        resetTokens.set(key, { userId: target.id, expiresAt: Date.now() + RESET_MS });
      } catch (error) {
        // The response remains identical for registered and unknown addresses.
        console.error('Reset email failed:', error.message);
      }
    }
    return json(res, 200, { ok: true, message: 'If the email is registered, a reset link has been sent.' });
  }
  if (pathname === '/api/auth/reset-password' && method === 'POST') {
    const token = safeText(body.token, 'Reset token', 200);
    if (!/^[0-9a-f]{64}$/.test(token)) fail(400, 'Invalid or expired reset link');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) fail(400, 'Password must contain 8–128 characters');
    const key = crypto.createHash('sha256').update(token).digest('hex');
    const reset = resetTokens.get(key);
    const target = reset && db.users.find(u => u.id === reset.userId && u.active !== false);
    if (!reset || !target || reset.expiresAt < Date.now()) { resetTokens.delete(key); fail(400, 'Invalid or expired reset link'); }
    target.passwordHash = hashPassword(body.password);
    resetTokens.delete(key); invalidateSessions(target.id); save();
    return json(res, 200, { ok: true });
  }
  function parseCsvRows(text) {
    const clean = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], cell = '', inQuotes = false;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i], next = clean[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { cell += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cell += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell.trim()); cell = '';
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && next === '\n') i++;
        row.push(cell.trim());
        if (row.some(Boolean)) rows.push(row);
        row = []; cell = '';
      } else {
        cell += ch;
      }
    }
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    return rows;
  }

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}
function xmlTagText(xml, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
  let match;
  while ((match = re.exec(xml))) out.push(decodeXmlEntities(match[1].replace(/<[^>]+>/g, '')));
  return out.join('');
}
function readXlsxArchive(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid XLSX file: ZIP directory not found');
  const count = buffer.readUInt16LE(eocd + 10);
  let pos = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error('Invalid XLSX file: bad central directory');
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLength);
    entries.set(name, { method, compressedSize, localOffset });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  function readEntry(name) {
    const entry = entries.get(name);
    if (!entry) return null;
    const local = entry.localOffset;
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid XLSX file: bad local header');
    const nameLength = buffer.readUInt16LE(local + 26);
    const extraLength = buffer.readUInt16LE(local + 28);
    const start = local + 30 + nameLength + extraLength;
    const raw = buffer.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return zlib.inflateRawSync(raw);
    throw new Error('Unsupported XLSX compression method');
  }
  return { names: Array.from(entries.keys()), readEntry };
}
function columnIndexFromRef(ref) {
  const match = String(ref || '').match(/([A-Za-z]+)/);
  if (!match) return 0;
  let index = 0;
  for (const ch of match[1].toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}
function parseXlsxRows(buffer) {
  const archive = readXlsxArchive(buffer);
  let shared = [];
  if (archive.names.includes('xl/sharedStrings.xml')) {
    const xml = archive.readEntry('xl/sharedStrings.xml').toString('utf8');
    const items = xml.match(/<si\b[\s\S]*?<\/si>/gi) || [];
    shared = items.map(item => xmlTagText(item, 't'));
  }
  const sheetName = archive.names.filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort()[0];
  if (!sheetName) throw new Error('XLSX file has no worksheet');
  const sheetXml = archive.readEntry(sheetName).toString('utf8');
  const rowMatches = sheetXml.match(/<row\b[^>]*>[\s\S]*?<\/row>/gi) || [];
  const rows = [];
  for (const rowXml of rowMatches) {
    const cellMatches = rowXml.match(/<c\b[^>]*>[\s\S]*?<\/c>/gi) || [];
    const row = [];
    for (const cellXml of cellMatches) {
      const refMatch = cellXml.match(/\br="([A-Za-z]+\d+)"/i) || cellXml.match(/\bref="([A-Za-z]+\d+)"/i);
      const col = columnIndexFromRef(refMatch ? refMatch[1] : '');
      const typeMatch = cellXml.match(/\bt="([^"]+)"/i);
      const type = typeMatch ? typeMatch[1] : '';
      let value = '';
      if (type === 'inlineStr') {
        value = xmlTagText(cellXml, 't');
      } else {
        const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/i);
        const rawValue = valueMatch ? valueMatch[1] : '';
        value = type === 's' ? (shared[Number(rawValue)] || '') : decodeXmlEntities(rawValue);
      }
      row[col] = String(value).trim();
    }
    while (row.length && !row[row.length - 1]) row.pop();
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}
function parseTsvRows(text) {
  return String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.split('\t')).filter(row => row.some(cell => String(cell || '').trim()));
}
function parseJsonRows(text) {
  const parsed = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : Array.isArray(parsed?.students) ? parsed.students : Array.isArray(parsed?.users) ? parsed.users : null;
  if (!list) fail(400, 'JSON import must be an array of objects');
  const headers = [...new Set(list.flatMap(item => Object.keys(item || {})))];
  if (!headers.length) fail(400, 'JSON import has no columns');
  return [headers, ...list.map(item => headers.map(key => item?.[key] == null ? '' : String(item[key])))];
}
function parseImportRows(body) {
  if (typeof body.csv === 'string') return parseCsvRows(body.csv);
  if (body.contentBase64) {
    const name = String(body.fileName || '').toLowerCase();
    const type = String(body.contentType || '').toLowerCase();
    const buffer = Buffer.from(String(body.contentBase64), 'base64');
    if (!buffer.length) fail(400, 'Uploaded spreadsheet is empty');
    if (name.endsWith('.xlsx') || type.includes('spreadsheetml.sheet')) return parseXlsxRows(buffer);
    if (name.endsWith('.tsv') || name.endsWith('.tab') || type.includes('tab-separated-values')) return parseTsvRows(buffer.toString('utf8'));
    if (name.endsWith('.json') || type.includes('json')) return parseJsonRows(buffer.toString('utf8'));
    if (name.endsWith('.csv') || name.endsWith('.txt') || type.includes('csv') || type === 'text/plain') return parseCsvRows(buffer.toString('utf8').replace(/^\uFEFF/, ''));
    if (name.endsWith('.xls')) fail(400, 'Old .xls format is not supported. Please save it as .xlsx, .csv, .tsv, or .json first.');
    fail(400, 'Unsupported file format. Please upload .xlsx, .csv, .tsv, or .json');
  }
  fail(400, 'Missing CSV or spreadsheet content');
}

  const IMPORT_HEADER_MAP = {
    '身份信息': 'role', '身份': 'role', '角色': 'role', 'role': 'role',
    '名字': 'name', '姓名': 'name', 'name': 'name',
    '性别': 'gender', 'gender': 'gender',
    '学号': 'studentId', 'studentid': 'studentId', 'student_id': 'studentId',
    '学校代码': 'schoolCode', 'schoolcode': 'schoolCode', 'school_code': 'schoolCode',
    '院系': 'department', '学院': 'department', 'department': 'department',
    '专业': 'major', 'major': 'major',
    '班级': 'className', '班级名称': 'className', '班': 'className', 'class': 'className', 'classname': 'className', 'class_name': 'className',
    '学年': 'grade', '年级': 'grade', 'academicyear': 'grade', 'grade': 'grade',
    '职位': 'position', '职务': 'position', '岗位': 'position', 'position': 'position',
    '账号': 'accountId', 'accountid': 'accountId', 'account_id': 'accountId', 'account': 'accountId',
    '临时密码': 'password', '密码': 'password', 'password': 'password',
    '邮箱': 'email', 'email': 'email',
  };
  if (pathname === '/api/admin/import/template' && method === 'GET') {
    requireAdmin(user);
    const targetRole = url.searchParams.get('role') === 'teacher' ? 'teacher' : 'student';
    const adminSchool = user.schoolId ? db.schools.find(s => s.id === user.schoolId) : null;
    const sampleCode = adminSchool?.code || '1008611';
    const csv = targetRole === 'student'
      ? '\uFEFF身份信息,名字,性别,学号,学校代码,院系,专业,班级,账号,临时密码\r\n' +
        `student,张三,男,20260101,${sampleCode},计算机学院,软件工程,软件1班,20260101,Pass202601!\r\n`
      : '\uFEFF身份信息,名字,性别,学校代码,院系,专业,账号,临时密码\r\n' +
        `teacher,李老师,女,${sampleCode},计算机学院,人工智能,tch202601,Pass202601!\r\n`;
    const format = String(url.searchParams.get('format') || 'csv').toLowerCase();
    if (format === 'json' || format === 'tsv') {
      const rows = parseCsvRows(csv);
      const headers = rows[0] || [];
      const content = format === 'json'
        ? JSON.stringify(rows.slice(1).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] || '']))), null, 2)
        : rows.map(row => row.join('\t')).join('\r\n');
      const filename = `${targetRole}-import-template.${format}`;
      res.writeHead(200, {
        'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/tab-separated-values; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      });
      res.end(content);
      return;
    }
    const filename = targetRole === 'student' ? 'student-import-template.csv' : 'teacher-import-template.csv';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.end(csv);
    return;
  }
  if (pathname === '/api/admin/import' && method === 'POST') {
    requireAdmin(user);
    const targetRole = body.role === 'teacher' ? 'teacher' : body.role === 'student' ? 'student' : fail(400, 'Invalid import role');
    const rows = parseImportRows(body);
    if (rows.length < 2) fail(400, 'Imported file must include a header row and at least one data row');
    const keys = rows[0].map(h => IMPORT_HEADER_MAP[h.toLowerCase()] || IMPORT_HEADER_MAP[h] || '');
    const requiredKeys = targetRole === 'student' ? ['role', 'name', 'studentId', 'password'] : ['role', 'name', 'accountId', 'password'];
    for (const reqKey of requiredKeys) {
      if (!keys.includes(reqKey)) fail(400, `Missing required column: ${reqKey}. Received headers: ${rows[0].map(h => h || '(blank)').join(', ')}`);
    }
    const adminSchool = user.schoolId ? db.schools.find(s => s.id === user.schoolId) : null;
    const errors = [];
    const staged = [];
    const seenAccountIds = new Set();
    const seenEmails = new Set();
    for (let idx = 1; idx < rows.length; idx++) {
      const rawRow = rows[idx];
      const rec = {};
      keys.forEach((k, colIdx) => { if (k) rec[k] = rawRow[colIdx] ?? ''; });
      const rowNum = idx + 1;
      try {
        const rowRole = String(rec.role || '').trim().toLowerCase();
        const normalizedRole = rowRole === '学生' ? 'student' : (rowRole === '老师' || rowRole === '教师') ? 'teacher' : rowRole;
        if (normalizedRole !== targetRole) throw new Error(`Role must be "${targetRole}"`);
        const name = safeText(rec.name, 'Name', 60);
        const gender = safeText(rec.gender ?? '', 'Gender', 30, false);
        const department = safeText(rec.department ?? '', 'Department', 80, false);
        const major = safeText(rec.major ?? '', 'Major', 80, false);
        const position = targetRole === 'teacher' ? normalizePosition(rec.position) : '';
        let school = adminSchool;
        const codeInput = String(rec.schoolCode || '').trim();
        if (codeInput) {
          const resolved = resolveSchool(codeInput);
          if (!isGlobalAdmin(user) && resolved.id !== user.schoolId) {
            throw new Error(`School code "${codeInput}" does not match your school`);
          }
          school = resolved;
        }
        let studentId = null;
        let accountId = null;
        if (targetRole === 'student') {
          studentId = validateRoleAccountId('student', rec.studentId);
          const rawAcct = String(rec.accountId || '').trim();
          if (rawAcct && rawAcct !== studentId) {
            throw new Error('Student accountId must match studentId');
          }
          accountId = studentId;
        } else {
          accountId = validateRoleAccountId('teacher', rec.accountId);
        }
        if (accountIdTaken(accountId) || seenAccountIds.has(accountId.toLowerCase())) {
          throw new Error(`Account ID "${accountId}" is already registered or duplicated`);
        }
        const password = String(rec.password || '');
        if (password.length < 8 || password.length > 128) {
          throw new Error('Temporary password must contain 8–128 characters');
        }
        let email = String(rec.email || '').trim().toLowerCase();
        if (email) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Invalid email "${email}"`);
          if (db.users.some(u => u.email.toLowerCase() === email) || seenEmails.has(email)) {
            throw new Error(`Email "${email}" is already registered or duplicated`);
          }
        } else {
          const domain = (school?.code || 'zhixing').toLowerCase().replace(/[^a-z0-9-]/g, '') + '.local';
          email = `${accountId.toLowerCase()}@${domain}`;
          let suffix = 1;
          while (db.users.some(u => u.email.toLowerCase() === email) || seenEmails.has(email)) {
            email = `${accountId.toLowerCase()}_${suffix++}@${domain}`;
          }
        }
        seenAccountIds.add(accountId.toLowerCase());
        seenEmails.add(email);
        staged.push({
          id: id('user'), role: targetRole, name, email, studentId, accountId,
          gender, department, major, className: String(rec.className || '').trim(), grade: String(rec.grade || '').trim(), ...(targetRole === 'teacher' ? { position } : {}),
          schoolId: school?.id || null,
          passwordHash: hashPassword(password),
          active: true, createdAt: now(),
        });
      } catch (err) {
        errors.push({ row: rowNum, message: err.message });
      }
    }
    if (errors.length) {
      return json(res, 400, { error: `Import failed on ${errors.length} row(s): Row ${errors[0].row}: ${errors[0].message}`, errors });
    }
    db.users.push(...staged);
    const classGroups = new Map();
    for (const item of staged) {
      if (item.role !== 'student' || !item.className) continue;
      const key = [item.schoolId || '', item.department || '', item.major || '', item.grade || '', item.className].join('|');
      (classGroups.get(key) || classGroups.set(key, []).get(key)).push(item);
    }
    let classesCreated = 0, classesUpdated = 0;
    for (const list of classGroups.values()) {
      const before = (db.studentClasses || []).length;
      findOrCreateClassForStudents({ name: list[0].className, department: list[0].department, major: list[0].major, grade: list[0].grade, academicYear: list[0].academicYear || '', schoolId: list[0].schoolId }, list.map(u => u.id), user);
      if ((db.studentClasses || []).length > before) classesCreated++; else classesUpdated++;
    }
    const autoEnrolled = autoEnrollIntoAllCourses(staged);
    save();
    return json(res, 201, { importedCount: staged.length, autoEnrolledCount: autoEnrolled, classesCreated, classesUpdated, classCount: classGroups.size, users: staged.map(publicUser) });
  }
  if (pathname === '/api/admin/backup/export' && method === 'GET') {
    requireAdmin(user);
    const global = isGlobalAdmin(user);
    const schools = global ? db.schools : db.schools.filter(s => s.id === user.schoolId);
    const users = global ? db.users : db.users.filter(u => u.schoolId === user.schoolId);
    const userIds = new Set(users.map(u => u.id));
    const teacherIds = new Set(users.filter(u => u.role === 'teacher').map(u => u.id));
    const courses = global ? db.courses : db.courses.filter(c => teacherIds.has(c.teacherId));
    const courseIds = new Set(courses.map(c => c.id));
    const payload = {
      exportedAt: now(),
      version: 2,
      schools,
      users,
      departments: global ? db.departments : db.departments.filter(d => d.schoolId === user.schoolId),
      studentClasses: global ? db.studentClasses : (db.studentClasses || []).filter(c => c.schoolId === user.schoolId),
      announcements: global ? db.announcements : db.announcements.filter(a => !a.schoolId || a.schoolId === user.schoolId),
      courses,
      enrollments: global ? db.enrollments : db.enrollments.filter(e => courseIds.has(e.courseId) || userIds.has(e.userId)),
      quizzes: global ? db.quizzes : db.quizzes.filter(q => courseIds.has(q.courseId)),
      attempts: global ? db.attempts : db.attempts.filter(a => courseIds.has(a.courseId)),
      posts: global ? db.posts : db.posts.filter(pt => courseIds.has(pt.courseId)),
      activity: global ? db.activity : db.activity.filter(act => courseIds.has(act.courseId) || userIds.has(act.userId)),
      assignments: global ? db.assignments : db.assignments.filter(asg => courseIds.has(asg.courseId)),
      submissions: global ? db.submissions : db.submissions.filter(sub => courseIds.has(sub.courseId)),
      grades: global ? db.grades : db.grades.filter(g => courseIds.has(g.courseId)),
      scheduling: global ? (db.scheduling || {}) : { [user.schoolId || 'global']: sched.ensureScope(db, user.schoolId || 'global') },
    };
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="zhixing-backup-${stamp}.json"`,
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(payload, null, 2));
    return;
  }
  if (pathname === '/api/admin/backup/merge' && method === 'POST') {
    requireAdmin(user);
    const data = body.backup && typeof body.backup === 'object' ? body.backup : body;
    if (!data || typeof data !== 'object') fail(400, 'Invalid backup JSON payload');
    const global = isGlobalAdmin(user);
    const merged = { schools: 0, users: 0, departments: 0, studentClasses: 0, announcements: 0, courses: 0, enrollments: 0, quizzes: 0, attempts: 0, posts: 0, assignments: 0, submissions: 0, grades: 0 };

    const schoolIds = new Set(db.schools.map(s => s.id));
    const schoolCodes = new Set(db.schools.map(s => String(s.code || '').toUpperCase()));
    const schoolNames = new Set(db.schools.map(s => normalizeSchoolName(s.name)));
    for (const s of (Array.isArray(data.schools) ? data.schools : [])) {
      if (!s?.id || !s?.name) continue;
      if (!global && s.id !== user.schoolId) continue;
      const code = String(s.code || '').toUpperCase();
      const norm = normalizeSchoolName(s.name);
      if (schoolIds.has(s.id) || (code && schoolCodes.has(code)) || schoolNames.has(norm)) continue;
      db.schools.push({ ...s });
      schoolIds.add(s.id);
      if (code) schoolCodes.add(code);
      schoolNames.add(norm);
      merged.schools++;
    }

    const userIds = new Set(db.users.map(u => u.id));
    const userEmails = new Set(db.users.map(u => String(u.email || '').toLowerCase()));
    const userAccts = new Set(db.users.flatMap(u => [u.accountId, u.studentId].filter(Boolean).map(x => String(x).toLowerCase())));
    for (const u of (Array.isArray(data.users) ? data.users : [])) {
      if (!u?.id || !u?.email || !u?.passwordHash) continue;
      if (!global && u.schoolId !== user.schoolId) continue;
      const em = String(u.email).toLowerCase();
      const ids = [u.accountId, u.studentId].filter(Boolean).map(x => String(x).toLowerCase());
      if (userIds.has(u.id) || userEmails.has(em) || ids.some(x => userAccts.has(x))) continue;
      db.users.push({
        ...u,
        gender: typeof u.gender === 'string' ? u.gender : '',
        grade: typeof u.grade === 'string' ? u.grade : '',
        department: typeof u.department === 'string' ? u.department : '',
        major: typeof u.major === 'string' ? u.major : '',
        accountId: u.accountId || u.studentId || null,
        active: u.active !== false,
      });
      userIds.add(u.id);
      userEmails.add(em);
      ids.forEach(x => userAccts.add(x));
      merged.users++;
    }

    const deptIds = new Set(db.departments.map(d => d.id));
    for (const d of (Array.isArray(data.departments) ? data.departments : [])) {
      if (!d?.id || !d?.name || deptIds.has(d.id)) continue;
      if (!global && d.schoolId !== user.schoolId) continue;
      db.departments.push({ ...d });
      deptIds.add(d.id);
      merged.departments++;
    }

    const classIds = new Set((db.studentClasses || []).map(c => c.id));
    for (const c of (Array.isArray(data.studentClasses) ? data.studentClasses : [])) {
      if (!c?.id || !c?.name || classIds.has(c.id)) continue;
      if (!global && c.schoolId && c.schoolId !== user.schoolId) continue;
      db.studentClasses.push({ studentIds: [], ...c });
      classIds.add(c.id);
      merged.studentClasses++;
    }

    const annIds = new Set(db.announcements.map(a => a.id));
    for (const a of (Array.isArray(data.announcements) ? data.announcements : [])) {
      if (!a?.id || !a?.title || annIds.has(a.id)) continue;
      if (!global && a.schoolId && a.schoolId !== user.schoolId) continue;
      db.announcements.push({ ...a });
      annIds.add(a.id);
      merged.announcements++;
    }

    const validTeacherIds = new Set(db.users.filter(u => u.role === 'teacher' && (global || u.schoolId === user.schoolId)).map(u => u.id));
    const courseIds = new Set(db.courses.map(c => c.id));
    const courseCodes = new Set(db.courses.map(c => String(c.enrollmentCode || '').toUpperCase()).filter(Boolean));
    for (const c of (Array.isArray(data.courses) ? data.courses : [])) {
      if (!c?.id || !c?.title || courseIds.has(c.id)) continue;
      if (!global && !validTeacherIds.has(c.teacherId)) continue;
      const code = String(c.enrollmentCode || '').toUpperCase();
      if (code && courseCodes.has(code)) continue;
      db.courses.push({ ...c, announcements: Array.isArray(c.announcements) ? c.announcements : [], gradeWeights: c.gradeWeights || { ...DEFAULT_WEIGHTS } });
      courseIds.add(c.id);
      if (code) courseCodes.add(code);
      merged.courses++;
    }

    const allowedCourseIds = new Set(db.courses.filter(c => global || validTeacherIds.has(c.teacherId)).map(c => c.id));
    const enrollKeys = new Set(db.enrollments.map(e => `${e.userId}:${e.courseId}`));
    for (const e of (Array.isArray(data.enrollments) ? data.enrollments : [])) {
      if (!e?.userId || !e?.courseId || enrollKeys.has(`${e.userId}:${e.courseId}`)) continue;
      if (!global && !allowedCourseIds.has(e.courseId)) continue;
      db.enrollments.push({ ...e });
      enrollKeys.add(`${e.userId}:${e.courseId}`);
      merged.enrollments++;
    }

    for (const [key, list] of [['quizzes', db.quizzes], ['attempts', db.attempts], ['posts', db.posts], ['assignments', db.assignments], ['submissions', db.submissions], ['grades', db.grades]]) {
      const seen = new Set(list.map(x => x.id));
      for (const item of (Array.isArray(data[key]) ? data[key] : [])) {
        if (!item?.id || seen.has(item.id)) continue;
        if (!global && item.courseId && !allowedCourseIds.has(item.courseId)) continue;
        list.push({ ...item });
        seen.add(item.id);
        merged[key]++;
      }
    }

    const actIds = new Set(db.activity.map(x => x.id));
    for (const act of (Array.isArray(data.activity) ? data.activity : [])) {
      if (!act?.id || actIds.has(act.id)) continue;
      if (!global && act.courseId && !allowedCourseIds.has(act.courseId)) continue;
      db.activity.push({ ...act });
      actIds.add(act.id);
    }

    if (data.scheduling && typeof data.scheduling === 'object') {
      if (!db.scheduling || typeof db.scheduling !== 'object') db.scheduling = {};
      for (const [sk, sv] of Object.entries(data.scheduling)) {
        if (!global && sk !== (user.schoolId || 'global')) continue;
        if (!db.scheduling[sk]) db.scheduling[sk] = sv;
      }
    }
    save();
    return json(res, 200, { ok: true, merged });
  }
  function schedScopeKey(u) { return u?.schoolId || 'global'; }
  function addAuditLog(scope, actor, action, detail, reason = '') {
    scope.auditLogs.unshift({ id: sched.id('log'), actorId: actor.id, actorName: actor.name, action, detail, reason, createdAt: sched.now() });
    if (scope.auditLogs.length > 500) scope.auditLogs.length = 500;
  }
function syncCoursesToSchedule(scope, user) {
  const manageableTeacherIds = new Set(db.users
    .filter(u => u.role === 'teacher' && canAdminManage(user, u))
    .map(u => u.id));
  const courses = db.courses.filter(c => courseTeacherIds(c).some(tid => manageableTeacherIds.has(tid)));
  const stats = { courses: courses.length, subjectsAdded: 0, subjectsUpdated: 0, plansAdded: 0, classesAdded: 0 };
  if (!scope.syncedCourseIds || typeof scope.syncedCourseIds !== 'object') scope.syncedCourseIds = {};
  for (const course of courses) {
    let subject = scope.subjects.find(s => s.sourceCourseId === course.id) || scope.subjects.find(s => s.name === course.title);
    if (!subject) {
      subject = { id: sched.id('sub'), name: course.title, code: course.enrollmentCode || '', group: course.category || '', tier: 'major', weeklyHours: 2, preference: 'any', avoidLastPeriod: false, consecutiveMode: 'none', consecutiveCount: 2, maxConsecutivePerWeek: 2, roomType: 'normal' };
      scope.subjects.push(subject); stats.subjectsAdded += 1;
    } else {
      stats.subjectsUpdated += 1;
    }
    subject.sourceCourseId = course.id;
    subject.name = course.title;
    subject.code = course.enrollmentCode || '';
    subject.group = course.category || '';
    subject.weeklyHours = Math.max(1, Math.min(30, Number(course.weeklyHours || 2)));

    const classLabel = course.targetDepartments?.[0] || course.category || '课程班';
    let cls = scope.classes.find(c => c.sourceCourseLabel === classLabel) || scope.classes.find(c => c.name === classLabel) || scope.classes.find(c => c.name === '课程同步-' + classLabel);
    if (!cls) {
      cls = { id: sched.id('cls'), name: '课程同步-' + classLabel, gradeId: '', studentIds: [], headTeacherId: '', blockedSlots: [], sourceCourseLabel: classLabel };
      scope.classes.push(cls); stats.classesAdded += 1;
    }
    const enrolledIds = db.enrollments.filter(e => e.courseId === course.id).map(e => e.userId);
    cls.studentIds = [...new Set([...(cls.studentIds || []), ...enrolledIds])];

    const teacherIds = courseTeacherIds(course).filter(tid => manageableTeacherIds.has(tid));
    for (const teacherId of (teacherIds.length ? teacherIds : [course.teacherId])) {
      if (!teacherId) continue;
      let plan = scope.plans.find(p => p.sourceCourseId === course.id && p.classId === cls.id && p.teacherId === teacherId);
      if (!plan) {
        plan = { id: sched.id('pln'), classId: cls.id, subjectId: subject.id, teacherId, roomId: '', weeklyHours: subject.weeklyHours, fixed: false, sourceCourseId: course.id };
        scope.plans.push(plan); stats.plansAdded += 1;
      }
      subject.department = course.ownerDepartment || course.departments?.[0] || subject.department || '';
      subject.major = (course.targetMajors || [])[0] || subject.major || '';
      subject.grade = course.academicYear || subject.grade || '';
      plan.subjectId = subject.id;
      plan.weeklyHours = subject.weeklyHours;
    }
    scope.syncedCourseIds[course.id] = subject.id;
  }
  return stats;
}
  if (pathname === '/api/admin/schedule' && method === 'GET') {
    requireAdmin(user);
    const key = isGlobalAdmin(user) && url.searchParams.get('schoolId') ? url.searchParams.get('schoolId') : schedScopeKey(user);
    const scope = sched.ensureScope(db, key);
    const courseSyncStats = syncCoursesToSchedule(scope, user);
    if (courseSyncStats.subjectsAdded || courseSyncStats.plansAdded || courseSyncStats.classesAdded) save();
    const teachers = db.users.filter(u => u.role === 'teacher' && canAdminManage(user, u)).map(publicUser);
    const students = db.users.filter(u => u.role === 'student' && canAdminManage(user, u)).map(publicUser);
    scope.teacherGradeMap = Object.fromEntries(teachers.map(t => [t.id, { name: t.name, grade: t.grade || '', crossGrades: t.crossGrades || [] }]));
    const conflicts = sched.detectAllConflicts(scope);
    const audit = sched.buildThreeTableAudit(scope);
    const courseOptions = db.courses.filter(c => isGlobalAdmin(user) || !c.schoolId || c.schoolId === user.schoolId).map(c => ({
      id: c.id, title: c.title, enrollmentCode: c.enrollmentCode || '', ownerDepartment: c.ownerDepartment || '',
      academicYear: c.academicYear || '', category: c.category || '', courseType: c.courseType || 'online',
      targetMajors: c.targetMajors || [], cover: c.cover || '📘', coverImage: c.coverImage || '',
    }));
    return json(res, 200, { scopeKey: key, scope, conflicts, audit, teachers, students, courseSyncStats, courseOptions, rules: sched.RULE_CATALOG, ruleConfig: scope.ruleConfig });
  }
  if (pathname === '/api/admin/schedule/audit' && method === 'GET') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.teacherGradeMap = Object.fromEntries(db.users.filter(u => u.role === 'teacher' && canAdminManage(user, u)).map(t => [t.id, { name: t.name, grade: t.grade || '', crossGrades: t.crossGrades || [] }]));
    return json(res, 200, { audit: sched.buildThreeTableAudit(scope), conflicts: sched.detectAllConflicts(scope), rules: sched.RULE_CATALOG, ruleConfig: scope.ruleConfig });
  }
  if (pathname === '/api/admin/schedule/sync-courses' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const stats = syncCoursesToSchedule(scope, user);
    addAuditLog(scope, user, '同步课程管理课程到排课', `新增科目 ${stats.subjectsAdded}，新增授课计划 ${stats.plansAdded}`);
    save();
    return json(res, 200, { ok: true, stats });
  }
  if (pathname === '/api/admin/schedule/rules' && method === 'GET') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    return json(res, 200, { rules: sched.RULE_CATALOG, categories: sched.RULE_CATEGORY_LABELS, config: scope.ruleConfig });
  }
  if (pathname === '/api/admin/schedule/rules' && method === 'PUT') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.ruleConfig = sched.normalizeRuleConfig(body.config || body);
    addAuditLog(scope, user, '更新排课规则关键词', `已更新 ${Object.keys(scope.ruleConfig).length} 条规则`);
    save();
    return json(res, 200, { ok: true, config: scope.ruleConfig });
  }
  if (pathname === '/api/admin/schedule/settings' && method === 'PUT') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    if (body.schoolLevel !== undefined) scope.settings.schoolLevel = safeText(body.schoolLevel, 'School level', 30);
    if (body.campusName !== undefined) scope.settings.campusName = safeText(body.campusName, 'Campus name', 60);
    if (body.daysPerWeek !== undefined) {
      const d = Number(body.daysPerWeek);
      if (![5, 6].includes(d)) fail(400, 'Days per week must be 5 or 6');
      scope.settings.daysPerWeek = d;
    }
    if (Array.isArray(body.periods) && body.periods.length) {
      scope.settings.periods = body.periods.map((item, idx) => ({
        id: String(item.id || sched.id('p')),
        index: Number(item.index ?? idx + 1),
        name: safeText(item.name, 'Period name', 30),
        startTime: safeText(item.startTime, 'Start time', 10),
        endTime: safeText(item.endTime, 'End time', 10),
        isBreak: Boolean(item.isBreak),
        breakLabel: safeText(item.breakLabel ?? '', 'Break label', 30, false),
      }));
    }
    if (Array.isArray(body.blockedSlots)) {
      scope.settings.blockedSlots = body.blockedSlots.filter(b => b?.key).map(b => ({ key: String(b.key), reason: safeText(b.reason ?? '特殊时段', 'Reason', 60, false) }));
    }
    addAuditLog(scope, user, '更新作息设置', `每周 ${scope.settings.daysPerWeek} 天，${scope.settings.periods.length} 个时段`);
    save();
    return json(res, 200, { settings: scope.settings });
  }
  if (pathname === '/api/admin/schedule/grades' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const grade = {
      id: sched.id('grd'),
      name: safeText(body.name, 'Grade name', 40),
      code: safeText(body.code ?? '', 'Grade code', 20, false),
      maxWeeklyPeriods: Math.max(1, Math.min(60, Number(body.maxWeeklyPeriods || 40))),
      stratified: Boolean(body.stratified),
    };
    scope.grades.push(grade); save();
    return json(res, 201, { grade });
  }
  let sMatch = pathname.match(/^\/api\/admin\/schedule\/grades\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    if (scope.classes.some(c => c.gradeId === sMatch[1])) fail(409, '请先删除或移出该年级下的班级');
    scope.grades = scope.grades.filter(g => g.id !== sMatch[1]); save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/schedule/classes' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const cls = {
      id: sched.id('cls'),
      name: safeText(body.name, 'Class name', 50),
      code: safeText(body.code ?? '', 'Class code', 20, false),
      gradeId: String(body.gradeId || ''),
      type: ['admin', 'elective', 'interest'].includes(body.type) ? body.type : 'admin',
      headTeacherId: String(body.headTeacherId || ''),
      studentCount: Math.max(0, Number(body.studentCount || 0)),
      blockedSlots: Array.isArray(body.blockedSlots) ? body.blockedSlots.map(String) : [],
      studentIds: Array.isArray(body.studentIds) ? body.studentIds.map(String) : [],
    };
    scope.classes.push(cls); save();
    return json(res, 201, { cls });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/classes\/([^/]+)$/);
  if (sMatch && method === 'PATCH') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const cls = scope.classes.find(c => c.id === sMatch[1]);
    if (!cls) fail(404, 'Class not found');
    if (body.name !== undefined) cls.name = safeText(body.name, 'Class name', 50);
    if (body.blockedSlots !== undefined && Array.isArray(body.blockedSlots)) cls.blockedSlots = body.blockedSlots.map(String);
    if (body.studentIds !== undefined && Array.isArray(body.studentIds)) cls.studentIds = body.studentIds.map(String);
    if (body.headTeacherId !== undefined) cls.headTeacherId = String(body.headTeacherId || '');
    save();
    return json(res, 200, { cls });
  }
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    if (scope.entries.some(e => e.classId === sMatch[1])) fail(409, '该班级已有排课记录，请先清空或解除课表关联');
    scope.classes = scope.classes.filter(c => c.id !== sMatch[1]);
    scope.plans = scope.plans.filter(p => p.classId !== sMatch[1]); save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/schedule/subjects' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const subject = {
      id: sched.id('sub'),
      name: safeText(body.name, 'Subject name', 50),
      code: safeText(body.code ?? '', 'Subject code', 20, false),
      group: safeText(body.group ?? '', 'Subject group', 40, false),
      tier: ['major', 'minor', 'public'].includes(body.tier) ? body.tier : 'major',
      weeklyHours: Math.max(1, Math.min(30, Number(body.weeklyHours || 4))),
      preference: ['morning', 'afternoon', 'any'].includes(body.preference) ? body.preference : 'any',
      avoidLastPeriod: Boolean(body.avoidLastPeriod),
      consecutiveMode: ['none', 'allow', 'require'].includes(body.consecutiveMode) ? body.consecutiveMode : 'none',
      consecutiveCount: Number(body.consecutiveCount) === 3 ? 3 : 2,
      maxConsecutivePerWeek: Math.max(1, Math.min(10, Number(body.maxConsecutivePerWeek || 2))),
      roomType: safeText(body.roomType ?? 'normal', 'Room type', 30, false),
    };
    scope.subjects.push(subject); save();
    return json(res, 201, { subject });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/subjects\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    if (scope.entries.some(e => e.subjectId === sMatch[1])) fail(409, '该科目已有排课记录，请先解除关联');
    scope.subjects = scope.subjects.filter(s => s.id !== sMatch[1]);
    scope.plans = scope.plans.filter(p => p.subjectId !== sMatch[1]); save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/schedule/rooms' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const room = {
      id: sched.id('rm'),
      name: safeText(body.name, 'Room name', 50),
      type: safeText(body.type ?? 'normal', 'Room type', 30, false),
      capacity: Math.max(1, Number(body.capacity || 50)),
      blockedSlots: Array.isArray(body.blockedSlots) ? body.blockedSlots.map(String) : [],
    };
    scope.rooms.push(room); save();
    return json(res, 201, { room });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/rooms\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.rooms = scope.rooms.filter(r => r.id !== sMatch[1]); save();
    return json(res, 200, { ok: true });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/teacher-rules\/([^/]+)$/);
  if (sMatch && method === 'PUT') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.teacherRules[sMatch[1]] = {
      availableSlots: Array.isArray(body.availableSlots) ? body.availableSlots.map(String) : [],
      blockedSlots: Array.isArray(body.blockedSlots) ? body.blockedSlots.map(String) : [],
      preference: ['morning', 'afternoon', 'any'].includes(body.preference) ? body.preference : 'any',
      maxDailyPeriods: Math.max(0, Math.min(15, Number(body.maxDailyPeriods || 0))),
      allowConsecutive: body.allowConsecutive !== false,
      avoidSameClassConsecutive: Boolean(body.avoidSameClassConsecutive),
    };
    save();
    return json(res, 200, { rule: scope.teacherRules[sMatch[1]] });
  }
  if (pathname === '/api/admin/schedule/plans' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const plan = {
      id: sched.id('pln'),
      classId: safeText(body.classId, 'Class', 60),
      subjectId: safeText(body.subjectId, 'Subject', 60),
      teacherId: safeText(body.teacherId, 'Teacher', 60),
      roomId: String(body.roomId || ''),
      weeklyHours: Math.max(1, Math.min(30, Number(body.weeklyHours || 2))),
      fixed: Boolean(body.fixed),
    };
    scope.plans.push(plan); save();
    return json(res, 201, { plan });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/plans\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.plans = scope.plans.filter(p => p.id !== sMatch[1]); save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/schedule/auto' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const allPlans = scope.plans;
    const selected = Array.isArray(body.courseIds) ? body.courseIds.filter(Boolean) : [];
    if (selected.length) scope.plans = allPlans.filter(p => selected.includes(p.sourceCourseId));
    let result;
    try { result = sched.autoSchedule(scope, { gradeId: body.gradeId || '' }); }
    finally { scope.plans = allPlans; }
    addAuditLog(scope, user, selected.length ? '按所选课程一键排课' : '一键智能排课', `成功排入 ${result.placedCount} 节，未排 ${result.unplaced.length} 项`);
    save();
    return json(res, 200, { ...result, entries: scope.entries });
  }
  if (pathname === '/api/admin/schedule/entries' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const ignore = body.id ? new Set([body.id]) : new Set();
    const candidate = {
      id: body.id || sched.id('ent'),
      planId: body.planId || 'custom',
      classId: safeText(body.classId, 'Class', 60),
      subjectId: safeText(body.subjectId, 'Subject', 60),
      teacherId: safeText(body.teacherId, 'Teacher', 60),
      roomId: body.roomId || null,
      day: Number(body.day),
      periodId: safeText(body.periodId, 'Period', 30),
      locked: Boolean(body.locked),
      temporary: Boolean(body.temporary),
      overrideReason: '',
      updatedAt: sched.now(),
    };
    const check = sched.checkPlacement(scope, candidate, ignore);
    if (!check.valid && !body.forceOverride) {
      const teachers = db.users.filter(u => u.role === 'teacher' && canAdminManage(user, u));
      return json(res, 409, {
        error: check.hard[0].message,
        hard: check.hard,
        warnings: check.warnings,
        alternatives: sched.suggestAlternatives(scope, candidate, 3),
        substitutes: sched.suggestSubstitutes(scope, teachers, candidate.day, candidate.periodId, candidate.subjectId),
      });
    }
    if (!check.valid && body.forceOverride) {
      const reason = safeText(body.overrideReason, '强制放行原因', 200);
      candidate.overrideReason = reason;
      addAuditLog(scope, user, '强制放行冲突排课', `${check.hard.map(h => h.message).join('；')}`, reason);
    } else {
      addAuditLog(scope, user, body.id ? '手动调课' : '手动排课', `周${candidate.day} ${candidate.periodId}`);
    }
    if (body.id) {
      const idx = scope.entries.findIndex(e => e.id === body.id);
      if (idx >= 0) scope.entries[idx] = candidate;
      else scope.entries.push(candidate);
    } else {
      scope.entries.push(candidate);
    }
    save();
    return json(res, 200, { entry: candidate, warnings: check.warnings, conflicts: sched.detectAllConflicts(scope) });
  }
  if (pathname === '/api/admin/schedule/swap' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const a = scope.entries.find(e => e.id === body.entryAId);
    const b = scope.entries.find(e => e.id === body.entryBId);
    if (!a || !b) fail(404, '未找到要互换的课程');
    if (a.locked || b.locked) fail(400, '已锁定的固定课程不可拖拽互换');
    const ignore = new Set([a.id, b.id]);
    const groupA = a.groupId ? scope.entries.filter(e => e.groupId === a.groupId && e.day === a.day && e.periodId === a.periodId) : [a];
    const groupB = b.groupId ? scope.entries.filter(e => e.groupId === b.groupId && e.day === b.day && e.periodId === b.periodId) : [b];
    const fullIgnore = new Set([...groupA.map(x => x.id), ...groupB.map(x => x.id)]);
    const hardAll = [], warnAll = [];
    for (const item of groupA) {
      const chk = sched.checkPlacement(scope, { ...item, day: b.day, periodId: b.periodId }, fullIgnore);
      hardAll.push(...chk.hard); warnAll.push(...chk.warnings);
    }
    for (const item of groupB) {
      const chk = sched.checkPlacement(scope, { ...item, day: a.day, periodId: a.periodId }, fullIgnore);
      hardAll.push(...chk.hard); warnAll.push(...chk.warnings);
    }
    if (hardAll.length && !body.forceOverride) {
      return json(res, 409, { error: hardAll[0].message, hard: hardAll, warnings: warnAll });
    }
    const dayA = a.day, perA = a.periodId, dayB = b.day, perB = b.periodId;
    for (const item of groupA) { item.day = dayB; item.periodId = perB; item.temporary = true; item.updatedAt = sched.now(); }
    for (const item of groupB) { item.day = dayA; item.periodId = perA; item.temporary = true; item.updatedAt = sched.now(); }
    addAuditLog(scope, user, '拖拽互换调课', `周${b.day}${b.periodId} ↔ 周${a.day}${a.periodId}`, body.overrideReason || '');
    save();
    return json(res, 200, { ok: true, entries: scope.entries, conflicts: sched.detectAllConflicts(scope) });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/entries\/([^/]+)\/lock$/);
  if (sMatch && method === 'PATCH') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const entry = scope.entries.find(e => e.id === sMatch[1]);
    if (!entry) fail(404, 'Entry not found');
    entry.locked = body.locked === undefined ? !entry.locked : Boolean(body.locked);
    save();
    return json(res, 200, { entry });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/entries\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const targetEntry = scope.entries.find(e => e.id === sMatch[1]);
    if (targetEntry?.groupId) {
      scope.entries = scope.entries.filter(e => !(e.groupId === targetEntry.groupId && e.day === targetEntry.day && e.periodId === targetEntry.periodId));
    } else {
      scope.entries = scope.entries.filter(e => e.id !== sMatch[1]);
    }
    addAuditLog(scope, user, '删除排课记录', sMatch[1]);
    save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/schedule/publish' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.published = {
      publishedAt: sched.now(),
      publishedBy: user.name,
      settings: structuredClone(scope.settings),
      grades: structuredClone(scope.grades),
      classes: structuredClone(scope.classes),
      subjects: structuredClone(scope.subjects),
      rooms: structuredClone(scope.rooms),
      entries: structuredClone(scope.entries),
    };
    addAuditLog(scope, user, '发布正式课表', `同步 ${scope.entries.length} 条排课记录给全校师生`);
    save();
    return json(res, 200, { published: scope.published });
  }
  if (pathname === '/api/admin/schedule/archive' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const archive = { id: sched.id('arc'), name: safeText(body.name || '课表存档', 'Archive name', 60), createdAt: sched.now(), entryCount: scope.entries.length, entries: structuredClone(scope.entries) };
    scope.archives.unshift(archive); save();
    return json(res, 201, { archive });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/requests\/([^/]+)\/review$/);
  if (sMatch && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const reqItem = scope.swapRequests.find(r => r.id === sMatch[1]);
    if (!reqItem || reqItem.status !== 'pending') fail(404, 'Pending swap request not found');
    const approve = body.decision === 'approve';
    reqItem.status = approve ? 'approved' : 'rejected';
    reqItem.reviewerName = user.name;
    reqItem.reviewNote = safeText(body.note ?? '', 'Review note', 200, false);
    reqItem.reviewedAt = sched.now();
    if (approve) {
      const entry = scope.entries.find(e => e.id === reqItem.entryId);
      if (entry) {
        if (reqItem.substituteTeacherId) entry.teacherId = reqItem.substituteTeacherId;
        if (reqItem.targetDay && reqItem.targetPeriodId) { entry.day = Number(reqItem.targetDay); entry.periodId = reqItem.targetPeriodId; }
        entry.temporary = true;
        entry.updatedAt = sched.now();
        if (scope.published) scope.published.entries = structuredClone(scope.entries);
      }
      addAuditLog(scope, user, '审批通过调课申请', `${reqItem.requesterName}: ${reqItem.reason}`);
    } else {
      addAuditLog(scope, user, '驳回调课申请', `${reqItem.requesterName}: ${reqItem.reason}`);
    }
    save();
    return json(res, 200, { request: reqItem });
  }
  if (pathname === '/api/admin/schedule/export' && method === 'GET') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const daysMap = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六' };
    const rows = ['\uFEFF星期,节次,时间,班级,科目,教师,教室,状态'];
    for (const e of scope.entries) {
      const p = scope.settings.periods.find(x => x.id === e.periodId);
      const cls = scope.classes.find(c => c.id === e.classId)?.name || '';
      const sub = scope.subjects.find(s => s.id === e.subjectId)?.name || '';
      const tch = db.users.find(u => u.id === e.teacherId)?.name || '';
      const rm = scope.rooms.find(r => r.id === e.roomId)?.name || '';
      const st = e.locked ? '已锁定' : e.temporary ? '临时调课' : '正常';
      rows.push([daysMap[e.day] || e.day, p?.name || e.periodId, p ? `${p.startTime}-${p.endTime}` : '', cls, sub, tch, rm, st].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="zhixing-timetable.csv"', 'Cache-Control': 'no-store' });
    res.end(rows.join('\r\n'));
    return;
  }
  // --- Teacher Groups & Reserved Activity Blocks (教研活动/集体会议) ---
  if (pathname === '/api/admin/schedule/teacher-groups' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const grp = {
      id: sched.id('tgrp'),
      name: safeText(body.name, 'Group name', 60),
      teacherIds: Array.isArray(body.teacherIds) ? [...new Set(body.teacherIds.map(String).filter(Boolean))] : [],
    };
    scope.teacherGroups.push(grp);
    addAuditLog(scope, user, '创建教师组', `${grp.name} (${grp.teacherIds.length}人)`);
    save();
    return json(res, 201, { group: grp });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/teacher-groups\/([^/]+)$/);
  if (sMatch && method === 'PUT') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const grp = scope.teacherGroups.find(g => g.id === sMatch[1]);
    if (!grp) fail(404, 'Teacher group not found');
    if (body.name !== undefined) grp.name = safeText(body.name, 'Group name', 60);
    if (Array.isArray(body.teacherIds)) grp.teacherIds = [...new Set(body.teacherIds.map(String).filter(Boolean))];
    addAuditLog(scope, user, '更新教师组成员', `${grp.name} (${grp.teacherIds.length}人)`);
    save();
    return json(res, 200, { group: grp });
  }
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.teacherGroups = scope.teacherGroups.filter(g => g.id !== sMatch[1]);
    scope.groupBlocks = scope.groupBlocks.filter(b => b.groupId !== sMatch[1]);
    save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/schedule/group-blocks' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const grp = scope.teacherGroups.find(g => g.id === body.groupId);
    if (!grp) fail(404, 'Teacher group not found');
    const periodIds = Array.isArray(body.periodIds) ? [...new Set(body.periodIds.map(String).filter(Boolean))] : [];
    if (!periodIds.length) fail(400, '请至少选择一个节次');
    const block = {
      id: sched.id('gblk'),
      groupId: grp.id,
      day: Math.max(1, Math.min(7, Number(body.day || 1))),
      periodIds,
      cycle: ['weekly', 'odd', 'even', 'custom'].includes(body.cycle) ? body.cycle : 'weekly',
      customWeeks: safeText(body.customWeeks ?? '', 'Custom weeks', 40, false),
      activityType: safeText(body.activityType || '教研活动', 'Activity type', 30),
      label: safeText(body.label || body.activityType || '教研活动', 'Activity label', 40),
      icon: safeText(body.icon || '🔔', 'Icon', 8, false),
      color: /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#fef3c7',
      active: true,
      createdAt: sched.now(),
    };
    scope.groupBlocks.push(block);
    addAuditLog(scope, user, '设置教师组固定无课时间', `${grp.name} · 周${block.day} · ${block.label}`);
    save();
    return json(res, 201, { block });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/group-blocks\/([^/]+)\/toggle$/);
  if (sMatch && method === 'PATCH') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const blk = scope.groupBlocks.find(b => b.id === sMatch[1]);
    if (!blk) fail(404, 'Group block not found');
    blk.active = !blk.active;
    addAuditLog(scope, user, blk.active ? '启用教师组无课时间' : '暂停教师组无课时间', blk.label);
    save();
    return json(res, 200, { block: blk });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/group-blocks\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.groupBlocks = scope.groupBlocks.filter(b => b.id !== sMatch[1]);
    save();
    return json(res, 200, { ok: true });
  }
  // --- Combined Classes (合班排课) ---
  if (pathname === '/api/admin/schedule/combined' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const planIds = Array.isArray(body.planIds) ? [...new Set(body.planIds.map(String))] : [];
    if (planIds.length < 2) fail(400, '请至少勾选 2 条同师同科的教学计划进行合班');
    const plans = planIds.map(pid => scope.plans.find(pl => pl.id === pid)).filter(Boolean);
    if (plans.length !== planIds.length) fail(404, '部分教学计划不存在');
    const teacherId = plans[0].teacherId;
    const subjectId = plans[0].subjectId;
    if (plans.some(pl => pl.teacherId !== teacherId || pl.subjectId !== subjectId)) {
      fail(400, '仅允许同一教师且同一科目的教学计划合并');
    }
    const classIds = [...new Set(plans.map(pl => pl.classId))];
    if (classIds.length < 2) fail(400, '合班需要选择不同的班级');
    const classNames = classIds.map(cid => scope.classes.find(c => c.id === cid)?.name || cid).join('+');
    const subjName = scope.subjects.find(s => s.id === subjectId)?.name || '';
    const grp = {
      id: sched.id('grp'),
      shortName: safeText(body.shortName || `${classNames} / ${subjName}`, 'Combined name', 80),
      teacherId, subjectId, classIds, planIds,
      roomId: String(body.roomId || plans[0].roomId || ''),
      weeklyHours: Number(body.weeklyHours || plans[0].weeklyHours || 2),
      createdAt: sched.now(),
    };
    scope.combinedGroups.push(grp);
    addAuditLog(scope, user, '创建合班课', grp.shortName);
    save();
    return json(res, 201, { group: grp });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/combined\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.combinedGroups = scope.combinedGroups.filter(g => g.id !== sMatch[1]);
    for (const e of scope.entries) if (e.groupId === sMatch[1]) delete e.groupId;
    addAuditLog(scope, user, '解除合班', sMatch[1]);
    save();
    return json(res, 200, { ok: true });
  }

  // --- Smart Student Placement (智能新生分班) ---
  if (pathname === '/api/admin/schedule/placement/template' && method === 'GET') {
    requireAdmin(user);
    const csv = '\uFEFF姓名,性别,学号,总分,语文,数学,英语,名次,特长标签,绑定组,互斥组,备注\r\n' +
      '张一,男,20260001,620,120,135,125,12,信息,twin1,,双胞胎\r\n' +
      '张二,女,20260002,615,118,130,128,15,,twin1,,双胞胎\r\n' +
      '李明,男,20260003,590,115,120,118,45,体育,,name_lm,\r\n' +
      '李明(重名),男,20260004,585,112,118,120,52,美术,,name_lm,\r\n';
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="student-placement-template.csv"', 'Cache-Control': 'no-store' });
    res.end(csv);
    return;
  }
  if (pathname === '/api/admin/schedule/placement/import' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    let imported = [];
    if (Array.isArray(body.students)) {
      imported = body.students.map((s, idx) => ({
        id: sched.id('pstu'),
        name: safeText(s.name, 'Student name', 60),
        gender: safeText(s.gender ?? '', 'Gender', 20, false),
        studentId: safeText(s.studentId ?? '', 'Student ID', 32, false),
        scores: { total: Number(s.scores?.total ?? s.total ?? 0), chinese: Number(s.scores?.chinese ?? s.chinese ?? 0), math: Number(s.scores?.math ?? s.math ?? 0), english: Number(s.scores?.english ?? s.english ?? 0) },
        rank: Number(s.rank || idx + 1),
        tags: { specialty: safeText(s.tags?.specialty ?? s.specialty ?? '', 'Specialty', 40, false) },
        bindGroup: safeText(s.bindGroup ?? '', 'Bind group', 40, false),
        mutexGroup: safeText(s.mutexGroup ?? '', 'Mutex group', 40, false),
        note: safeText(s.note ?? '', 'Note', 100, false),
      }));
    } else if (typeof body.csv === 'string') {
      const rows = parseCsvRows(body.csv);
      if (rows.length < 2) fail(400, 'CSV 至少需要表头和一行新生数据');
      const hdr = rows[0];
      const idxOf = (...names) => hdr.findIndex(h => names.includes(h.trim()));
      const iName = idxOf('姓名', '名字', 'name');
      if (iName < 0) fail(400, '缺少“姓名”列');
      const iGender = idxOf('性别', 'gender');
      const iStuId = idxOf('学号', 'studentId');
      const iTotal = idxOf('总分', 'total');
      const iChi = idxOf('语文', 'chinese');
      const iMath = idxOf('数学', 'math');
      const iEng = idxOf('英语', 'english');
      const iRank = idxOf('名次', 'rank');
      const iTag = idxOf('特长标签', '特长', 'specialty');
      const iBind = idxOf('绑定组', 'bindGroup');
      const iMutex = idxOf('互斥组', 'mutexGroup');
      const iNote = idxOf('备注', 'note');
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row[iName]) continue;
        imported.push({
          id: sched.id('pstu'),
          name: safeText(row[iName], 'Name', 60),
          gender: iGender >= 0 ? (row[iGender] || '') : '',
          studentId: iStuId >= 0 ? (row[iStuId] || '') : '',
          scores: { total: Number(row[iTotal] || 0), chinese: Number(row[iChi] || 0), math: Number(row[iMath] || 0), english: Number(row[iEng] || 0) },
          rank: Number(row[iRank] || r),
          tags: { specialty: iTag >= 0 ? (row[iTag] || '') : '' },
          bindGroup: iBind >= 0 ? (row[iBind] || '') : '',
          mutexGroup: iMutex >= 0 ? (row[iMutex] || '') : '',
          note: iNote >= 0 ? (row[iNote] || '') : '',
        });
      }
    } else fail(400, '请提供 CSV 或学生列表');
    scope.placement.students = imported;
    scope.placement.result = null;
    save();
    return json(res, 200, { count: imported.length, students: imported });
  }
  if (pathname === '/api/admin/schedule/placement/preview' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    if (!scope.placement.students.length) fail(400, '请先导入新生名单');
    const cfg = {
      classCount: Math.max(1, Math.min(50, Number(body.classCount || scope.placement.config?.classCount || 2))),
      classPrefix: safeText(body.classPrefix || scope.placement.config?.classPrefix || '新生', 'Class prefix', 30),
      mode: ['total', 'subjects', 'rankBand', 'percentTier'].includes(body.mode) ? body.mode : 'total',
      genderBalance: body.genderBalance !== false,
      gradeId: String(body.gradeId || ''),
    };
    scope.placement.config = cfg;
    scope.placement.result = sched.runSmartPlacement(scope.placement.students, cfg);
    save();
    return json(res, 200, { result: scope.placement.result });
  }
  if (pathname === '/api/admin/schedule/placement/commit' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    if (!Array.isArray(scope.placement.result) || !scope.placement.result.length) fail(400, '请先执行分班预览');
    const createdClasses = [];
    for (const clsRes of scope.placement.result) {
      const matchedUserIds = clsRes.students.map(ps => db.users.find(u => u.role === 'student' && (u.studentId === ps.studentId || u.name === ps.name) && canAdminManage(user, u))?.id).filter(Boolean);
      const cls = {
        id: sched.id('cls'),
        name: clsRes.name,
        code: '',
        gradeId: scope.placement.config?.gradeId || '',
        type: 'admin',
        headTeacherId: '',
        studentCount: clsRes.count,
        blockedSlots: [],
        studentIds: matchedUserIds,
      };
      scope.classes.push(cls);
      createdClasses.push(cls);
    }
    addAuditLog(scope, user, '正式生成分班班级', `生成 ${createdClasses.length} 个行政班`);
    save();
    return json(res, 201, { classes: createdClasses });
  }
  if (pathname === '/api/admin/schedule/placement/export' && method === 'GET') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const rows = ['\uFEFF新班级,姓名,性别,学号,总分,原名次,特长标签,备注'];
    for (const cls of (scope.placement.result || [])) {
      for (const s of (cls.students || [])) {
        rows.push([cls.name, s.name, s.gender, s.studentId || '', s.total, s.rank, s.specialty || '', s.note || ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="placement-roster.csv"', 'Cache-Control': 'no-store' });
    res.end(rows.join('\r\n'));
    return;
  }

  // --- Exam Proctoring (监考安排) ---
  if (pathname === '/api/admin/schedule/exams' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const exam = {
      id: sched.id('exm'),
      name: safeText(body.name, 'Exam name', 80),
      startDate: safeText(body.startDate ?? '', 'Start date', 20, false),
      endDate: safeText(body.endDate ?? '', 'End date', 20, false),
      slots: Array.isArray(body.slots) ? body.slots.map((sl, idx) => ({
        id: sl.id || sched.id('esl'),
        dateLabel: safeText(sl.dateLabel || `第${idx + 1}场`, 'Date label', 40),
        periodName: safeText(sl.periodName || '上午', 'Period name', 30),
        startTime: safeText(sl.startTime || '08:30', 'Start', 10),
        endTime: safeText(sl.endTime || '10:30', 'End', 10),
        dayOfWeek: sl.dayOfWeek ? Number(sl.dayOfWeek) : null,
        periodId: sl.periodId ? String(sl.periodId) : '',
        subjectId: sl.subjectId ? String(sl.subjectId) : '',
        subjectName: safeText(sl.subjectName ?? '', 'Subject', 40, false),
      })) : [],
      rooms: Array.isArray(body.rooms) ? body.rooms.map(r => ({
        id: r.id || sched.id('erm'),
        name: safeText(r.name, 'Exam room', 50),
        classId: r.classId ? String(r.classId) : '',
        capacity: Number(r.capacity || 40),
      })) : [],
      teacherIds: Array.isArray(body.teacherIds) ? body.teacherIds.map(String) : [],
      rules: {
        taughtClass: ['any', 'avoid', 'prefer'].includes(body.rules?.taughtClass) ? body.rules.taughtClass : 'avoid',
        taughtSubject: ['any', 'avoid', 'prefer'].includes(body.rules?.taughtSubject) ? body.rules.taughtSubject : 'avoid',
        proctorsPerRoom: Math.max(1, Math.min(3, Number(body.rules?.proctorsPerRoom || 1))),
      },
      assignments: [],
      status: 'draft',
      publishedAt: null,
      publishedSnapshot: null,
      createdAt: sched.now(),
    };
    scope.exams.unshift(exam);
    save();
    return json(res, 201, { exam });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/exams\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.exams = scope.exams.filter(ex => ex.id !== sMatch[1]); save();
    return json(res, 200, { ok: true });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/exams\/([^/]+)\/auto$/);
  if (sMatch && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const exam = scope.exams.find(ex => ex.id === sMatch[1]);
    if (!exam) fail(404, 'Exam not found');
    const teachers = db.users.filter(u => u.role === 'teacher' && canAdminManage(user, u));
    const resObj = sched.autoAssignProctors(scope, exam, teachers);
    exam.status = 'draft'; exam.publishedAt = null; exam.publishedSnapshot = null;
    addAuditLog(scope, user, '自动排监考', `${exam.name}：生成 ${resObj.assignments.length} 条监考安排（已撤回旧同步）`);
    save();
    return json(res, 200, { exam, ...resObj });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/exams\/([^/]+)\/reassign$/);
  if (sMatch && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const exam = scope.exams.find(ex => ex.id === sMatch[1]);
    if (!exam) fail(404, 'Exam not found');
    const asg = exam.assignments.find(a => a.id === body.assignmentId);
    if (!asg) fail(404, 'Assignment not found');
    const newIds = Array.isArray(body.teacherIds) ? [...new Set(body.teacherIds.map(String).filter(Boolean))] : [];
    const slot = exam.slots.find(s => s.id === asg.slotId);
    for (const tid of newIds) {
      const clash = exam.assignments.some(a => a.id !== asg.id && a.slotId === asg.slotId && a.teacherIds.includes(tid));
      if (clash) fail(409, '该教师在同一考试时段已安排其他考场监考');
      if (slot?.dayOfWeek && slot?.periodId && scope.entries.some(e => Number(e.day) === Number(slot.dayOfWeek) && e.periodId === slot.periodId && e.teacherId === tid)) {
        fail(409, '该教师在该时段有正常上课安排，不可兼任监考');
      }
    }
    asg.teacherIds = newIds;
    exam.status = 'draft'; exam.publishedAt = null; exam.publishedSnapshot = null;
    save();
    return json(res, 200, { assignment: asg });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/exams\/([^/]+)\/publish$/);
  if (sMatch && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const exam = scope.exams.find(ex => ex.id === sMatch[1]);
    if (!exam) fail(404, 'Exam not found');
    const expected = (exam.slots || []).length * (exam.rooms || []).length;
    const assignments = exam.assignments || [];
    if (!expected) fail(409, '请先添加考试场次和考场');
    if (assignments.length < expected || assignments.some(a => !(a.teacherIds || []).length)) {
      fail(409, '请先完成所有场次和考场的监考分配');
    }
    const publishedAt = now();
    exam.status = 'published';
    exam.publishedAt = publishedAt;
    exam.publishedSnapshot = JSON.parse(JSON.stringify({
      id: exam.id, name: exam.name, startDate: exam.startDate || '', endDate: exam.endDate || '',
      slots: exam.slots || [], rooms: exam.rooms || [], assignments, rules: exam.rules || {}, publishedAt,
    }));
    addAuditLog(scope, user, '发布考试监考安排', `${exam.name} 已同步给相关教师和学生`);
    save();
    return json(res, 200, { exam });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/exams\/([^/]+)\/unpublish$/);
  if (sMatch && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const exam = scope.exams.find(ex => ex.id === sMatch[1]);
    if (!exam) fail(404, 'Exam not found');
    exam.status = 'draft'; exam.publishedAt = null; exam.publishedSnapshot = null;
    addAuditLog(scope, user, '撤回考试监考安排', `${exam.name} 已停止向师生同步`);
    save();
    return json(res, 200, { exam });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/exams\/([^/]+)\/export$/);
  if (sMatch && method === 'GET') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const exam = scope.exams.find(ex => ex.id === sMatch[1]);
    if (!exam) fail(404, 'Exam not found');
    const rows = ['\uFEFF考试名称,场次日期,时间,科目,考场,监考教师'];
    for (const a of (exam.assignments || [])) {
      const sl = exam.slots.find(s => s.id === a.slotId);
      const rm = exam.rooms.find(r => r.id === a.roomId);
      const names = (a.teacherIds || []).map(tid => db.users.find(u => u.id === tid)?.name || tid).join('、');
      rows.push([exam.name, sl?.dateLabel || '', sl ? `${sl.startTime}-${sl.endTime}` : '', sl?.subjectName || '', rm?.name || '', names].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="exam-proctoring.csv"', 'Cache-Control': 'no-store' });
    res.end(rows.join('\r\n'));
    return;
  }
function publishedExamsFor(user, scope) {
  const exams = (scope.exams || []).filter(ex => ex.status === 'published' && ex.publishedSnapshot);
  const myClassIds = new Set((scope.classes || []).filter(c => Array.isArray(c.studentIds) && c.studentIds.includes(user.id)).map(c => c.id));
  const result = [];
  for (const ex of exams) {
    const snap = ex.publishedSnapshot;
    let assignments = Array.isArray(snap.assignments) ? snap.assignments : [];
    if (user.role === 'teacher') {
      assignments = assignments.filter(a => (a.teacherIds || []).includes(user.id));
    } else if (user.role === 'student') {
      assignments = assignments.filter(a => {
        const room = (snap.rooms || []).find(r => r.id === a.roomId);
        return room && myClassIds.has(String(room.classId || ''));
      });
    } else if (user.role !== 'admin') {
      assignments = [];
    }
    if (!assignments.length && user.role !== 'admin') continue;
    result.push({
      id: ex.id, name: snap.name || '', startDate: snap.startDate || '', endDate: snap.endDate || '',
      publishedAt: ex.publishedAt, slots: snap.slots || [], rooms: snap.rooms || [],
      assignments: assignments.map(a => ({
        ...a,
        teacherNames: (a.teacherIds || []).map(tid => db.users.find(u => u.id === tid)?.name || tid).join('、'),
      })),
    });
  }
  return result;
}
  if (pathname === '/api/schedule/my' && method === 'GET') {
    requireUser(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const pub = scope.published;
    const myExams = publishedExamsFor(user, scope);
    if (!pub) return json(res, 200, { published: false, entries: [], periods: scope.settings.periods, daysPerWeek: scope.settings.daysPerWeek, swapRequests: [], exams: myExams });
    let entries = [];
    if (user.role === 'teacher') {
      entries = pub.entries.filter(e => e.teacherId === user.id);
    } else if (user.role === 'student') {
      const myClassIds = new Set((pub.classes || []).filter(c => Array.isArray(c.studentIds) && c.studentIds.includes(user.id)).map(c => c.id));
      entries = myClassIds.size ? pub.entries.filter(e => myClassIds.has(e.classId)) : pub.entries;
    } else {
      entries = pub.entries;
    }
    const enriched = entries.map(e => ({
      ...e,
      className: pub.classes.find(c => c.id === e.classId)?.name || '',
      subjectName: pub.subjects.find(s => s.id === e.subjectId)?.name || '',
      teacherName: db.users.find(u => u.id === e.teacherId)?.name || '',
      roomName: pub.rooms.find(r => r.id === e.roomId)?.name || '',
    }));
    const swapRequests = user.role === 'teacher' ? scope.swapRequests.filter(r => r.requesterId === user.id) : [];
    const schoolTeachers = user.role === 'teacher' ? db.users.filter(u => u.role === 'teacher' && u.schoolId === user.schoolId && u.active !== false).map(u => ({ id: u.id, name: u.name })) : [];
    const myGroupIds = new Set((scope.teacherGroups || []).filter(g => Array.isArray(g.teacherIds) && g.teacherIds.includes(user.id)).map(g => g.id));
    const groupActivities = user.role === 'teacher' ? (scope.groupBlocks || []).filter(b => b.active !== false && myGroupIds.has(b.groupId)).map(b => ({ ...b, groupName: scope.teacherGroups.find(g => g.id === b.groupId)?.name || '' })) : [];
    return json(res, 200, { published: true, publishedAt: pub.publishedAt, daysPerWeek: pub.settings.daysPerWeek, periods: pub.settings.periods, entries: enriched, groupActivities, swapRequests, schoolTeachers, exams: myExams });
  }
  if (pathname === '/api/teacher/schedule/requests' && method === 'POST') {
    requireRole(user, 'teacher');
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const entry = scope.entries.find(e => e.id === body.entryId && e.teacherId === user.id);
    if (!entry) fail(404, '未找到您负责的该节课程');
    const reqItem = {
      id: sched.id('swp'),
      requesterId: user.id,
      requesterName: user.name,
      entryId: entry.id,
      targetDay: body.targetDay ? Number(body.targetDay) : null,
      targetPeriodId: body.targetPeriodId ? String(body.targetPeriodId) : null,
      substituteTeacherId: body.substituteTeacherId ? String(body.substituteTeacherId) : null,
      reason: safeText(body.reason, '调课原因', 300),
      status: 'pending',
      createdAt: sched.now(),
    };
    scope.swapRequests.unshift(reqItem); save();
    return json(res, 201, { request: reqItem });
  }
  if (pathname === '/api/admin/overview' && method === 'GET') {
    requireAdmin(user);
    const organization = db.schools.find(school => school.id === user.schoolId) || null;
    const teachers = db.users.filter(u => u.role === 'teacher' && canAdminManage(user, u));
    const teacherIds = new Set(teachers.map(teacher => teacher.id));
    const courses = db.courses.filter(course => courseTeacherIds(course).some(tid => teacherIds.has(tid))).map(c => {
      const tIds = courseTeacherIds(c);
      const assigned = tIds.map(tid => db.users.find(u => u.id === tid)).filter(Boolean);
      const enrolledList = db.enrollments.filter(e => e.courseId === c.id).map(e => db.users.find(u => u.id === e.userId && u.active !== false)).filter(Boolean);
      return {
        id: c.id, title: c.title, description: c.description || '', category: c.category || '',
        academicYear: c.academicYear || '', ownerDepartment: c.ownerDepartment || '', courseType: c.courseType || 'online',
        cover: c.cover || '📘', color: c.color || '#6979dc', coverImage: c.coverImage || '',
        targetDepartments: c.targetDepartments || [], targetMajors: c.targetMajors || [], targetClassIds: c.targetClassIds || [], autoEnroll: Boolean(c.autoEnroll),
        cover: c.cover || '📘', color: c.color || '#6979dc',
        teacherId: c.teacherId, teacherIds: tIds,
        teacherName: assigned.map(t => t.name).join(', ') || 'Instructor',
        departments: [...new Set(assigned.map(t => t.department).filter(Boolean))],
        enrollmentCode: c.enrollmentCode,
        lessonCount: (c.lessons || []).length,
        quizAvailable: Boolean(quizByCourse(c.id)?.questions?.length),
        studentCount: enrolledList.length,
        enrolledStudents: enrolledList.map(s => ({ id: s.id, name: s.name, studentId: s.studentId || '', email: s.email, department: s.department || '', major: s.major || '' })),
        createdAt: c.createdAt,
      };
    });
    const courseIds = new Set(courses.map(course => course.id));
    const students = db.users.filter(u => u.role === 'student' && canAdminManage(user, u)).map(u => ({ ...publicUser(u), enrollments: db.enrollments.filter(e => e.userId === u.id && courseIds.has(e.courseId)).map(e => { const course = db.courses.find(c => c.id === e.courseId); return course ? { courseId: course.id, courseTitle: course.title, teacherName: db.users.find(t => t.id === course.teacherId)?.name || 'Instructor' } : null; }).filter(Boolean) }));
    const organizations = isGlobalAdmin(user) ? db.schools.map(school => ({ id: school.id, name: school.name, code: school.code, stage: school.stage || 'university' })) : organization ? [{ id: organization.id, name: organization.name, code: organization.code, stage: organization.stage || 'university' }] : [];
    const pendingTeachers = db.users
      .filter(u => u.role === 'teacher' && u.active !== false && u.pendingSchoolId && (isGlobalAdmin(user) || u.pendingSchoolId === user.schoolId))
      .map(t => ({ ...publicUser(t), requestedAt: t.pendingSchoolRequestedAt || t.createdAt }));
    const deptMap = new Map();
    for (const d of db.departments) {
      if (isGlobalAdmin(user) || d.schoolId === user.schoolId) deptMap.set(d.name, d);
    }
    for (const u of [...teachers, ...students]) {
      if (u.department && !deptMap.has(u.department)) {
        deptMap.set(u.department, { id: null, schoolId: u.schoolId || null, name: u.department, derived: true });
      }
    }
    const departments = [...deptMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    const classList = classesForAdmin(user).map(publicStudentClass);
    const announcements = db.announcements
      .filter(a => isGlobalAdmin(user) || !a.schoolId || a.schoolId === user.schoolId)
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    return json(res, 200, { organization: organization ? { id: organization.id, name: organization.name, code: organization.code, stage: organization.stage || 'university' } : null, organizations, schoolStages: SCHOOL_STAGES, departments, classes: classList, announcements, teachers: teachers.map(t => ({ ...publicUser(t), courseCount: db.courses.filter(c => courseTeacherIds(c).includes(t.id)).length })), pendingTeachers, students, courses, stats: { teachers: teachers.length, students: students.length, classes: classList.length, courses: courses.length, pendingTeachers: pendingTeachers.length, announcements: announcements.length } });
  }
  if (pathname === '/api/announcements' && method === 'GET') {
    requireUser(user);
    const list = db.announcements
      .filter(a => isGlobalAdmin(user) || !a.schoolId || a.schoolId === user.schoolId)
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    return json(res, 200, { announcements: list });
  }
  if (pathname === '/api/admin/announcements' && method === 'POST') {
    requireAdmin(user);
    const category = ['school', 'college', 'academic'].includes(body.category) ? body.category : fail(400, 'Announcement category must be school, college, or academic');
    const title = safeText(body.title, 'Announcement title', 120);
    const content = safeText(body.content, 'Announcement content', 5000);
    const announcement = {
      id: id('ann'),
      schoolId: isGlobalAdmin(user) ? (body.schoolId || null) : user.schoolId,
      category, title, content,
      authorId: user.id, authorName: user.name,
      createdAt: now(), updatedAt: now(),
    };
    db.announcements.push(announcement); save();
    return json(res, 201, { announcement });
  }
  let annMatch = pathname.match(/^\/api\/admin\/announcements\/([^/]+)$/);
  if (annMatch && method === 'PATCH') {
    requireAdmin(user);
    const ann = db.announcements.find(a => a.id === annMatch[1]);
    if (!ann || (!isGlobalAdmin(user) && ann.schoolId !== user.schoolId)) fail(404, 'Announcement not found');
    if (body.category !== undefined) {
      if (!['school', 'college', 'academic'].includes(body.category)) fail(400, 'Announcement category must be school, college, or academic');
      ann.category = body.category;
    }
    if (body.title !== undefined) ann.title = safeText(body.title, 'Announcement title', 120);
    if (body.content !== undefined) ann.content = safeText(body.content, 'Announcement content', 5000);
    ann.updatedAt = now();
    save();
    return json(res, 200, { announcement: ann });
  }
  if (annMatch && method === 'DELETE') {
    requireAdmin(user);
    const idx = db.announcements.findIndex(a => a.id === annMatch[1]);
    if (idx < 0 || (!isGlobalAdmin(user) && db.announcements[idx].schoolId !== user.schoolId)) fail(404, 'Announcement not found');
    db.announcements.splice(idx, 1); save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/classes/assign' && method === 'POST') {
    requireAdmin(user);
    const studentIds = normalizeIdList(body.studentIds, 'Student ID').map(x => x);
    if (!studentIds.length) fail(400, 'Select at least one student');
    const cls = assignStudentsToClass(user, studentIds, {
      name: body.className, department: body.department || '', major: body.major || '',
      grade: body.grade || '', academicYear: body.academicYear || '',
      schoolId: isGlobalAdmin(user) ? (body.schoolId || undefined) : user.schoolId,
    });
    save();
    return json(res, 200, { classInfo: publicStudentClass(cls) });
  }
  if (pathname === '/api/admin/classes' && method === 'POST') {
    requireAdmin(user);
    const name = safeText(body.name, 'Class name', 80);
    const grade = safeText(body.grade ?? '', 'Grade', 40, false);
    const department = safeText(body.department ?? '', 'Department', 80, false);
    const academicYear = safeText(body.academicYear ?? '', 'Academic year', 40, false);
    const schoolId = isGlobalAdmin(user) ? (body.schoolId || null) : user.schoolId;
    const duplicate = (db.studentClasses || []).some(c => c.schoolId === schoolId && c.name.toLowerCase() === name.toLowerCase() && (c.grade || '') === grade && (c.department || '') === department);
    if (duplicate) fail(409, 'This class already exists');
    const members = resolveStudents(user, body.studentIds || []);
    const cls = { id: id('class'), schoolId, name, grade, department, academicYear, studentIds: members.map(s => s.id), createdAt: now(), updatedAt: now() };
    db.studentClasses.push(cls); save();
    return json(res, 201, { classInfo: publicStudentClass(cls) });
  }
  let classMatch = pathname.match(/^\/api\/admin\/classes\/([^/]+)$/);
  if (classMatch && method === 'PATCH') {
    requireAdmin(user);
    const cls = findManagedClass(user, classMatch[1]);
    if (body.name !== undefined) cls.name = safeText(body.name, 'Class name', 80);
    if (body.grade !== undefined) cls.grade = safeText(body.grade ?? '', 'Grade', 40, false);
    if (body.department !== undefined) cls.department = safeText(body.department ?? '', 'Department', 80, false);
    if (body.academicYear !== undefined) cls.academicYear = safeText(body.academicYear ?? '', 'Academic year', 40, false);
    if (body.studentIds !== undefined) cls.studentIds = resolveStudents(user, body.studentIds).map(s => s.id);
    cls.updatedAt = now(); save();
    return json(res, 200, { classInfo: publicStudentClass(cls) });
  }
  if (classMatch && method === 'DELETE') {
    requireAdmin(user);
    findManagedClass(user, classMatch[1]);
    db.studentClasses = db.studentClasses.filter(c => c.id !== classMatch[1]);
    save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/departments' && method === 'POST') {
    requireAdmin(user);
    const name = safeText(body.name, 'Department name', 80);
    const schoolId = isGlobalAdmin(user) ? (body.schoolId || null) : user.schoolId;
    if (db.departments.some(d => d.schoolId === schoolId && d.name.toLowerCase() === name.toLowerCase())) {
      fail(409, 'This department already exists');
    }
    const department = { id: id('dept'), schoolId, name, createdAt: now() };
    db.departments.push(department); save();
    return json(res, 201, { department });
  }
  let deptMatch = pathname.match(/^\/api\/admin\/departments\/([^/]+)$/);
  if (deptMatch && method === 'DELETE') {
    requireAdmin(user);
    const idx = db.departments.findIndex(d => d.id === deptMatch[1]);
    if (idx < 0 || (!isGlobalAdmin(user) && db.departments[idx].schoolId !== user.schoolId)) fail(404, 'Department not found');
    db.departments.splice(idx, 1); save();
    return json(res, 200, { ok: true });
  }
  let userDeptMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/department$/);
  if (userDeptMatch && method === 'PATCH') {
    requireAdmin(user);
    const target = db.users.find(u => u.id === userDeptMatch[1] && ['teacher', 'student'].includes(u.role));
    if (!target || !canAdminManage(user, target)) fail(404, 'Account not found');
    if (body.department !== undefined) target.department = safeText(body.department ?? '', 'Department', 80, false);
    if (body.major !== undefined) target.major = safeText(body.major ?? '', 'Major', 80, false);
    if (target.role === 'teacher') {
      if (body.grade !== undefined) target.grade = safeText(body.grade ?? '', 'Grade', 40, false);
      if (body.crossGrades !== undefined) target.crossGrades = normalizeListValue(body.crossGrades, 'Cross grade', 40);
    }
    save();
    return json(res, 200, { user: publicUser(target) });
  }
  let reqMatch = pathname.match(/^\/api\/admin\/teacher-requests\/([^/]+)\/(approve|reject)$/);
  if (reqMatch && method === 'POST') {
    requireAdmin(user);
    const teacher = db.users.find(u => u.id === reqMatch[1] && u.role === 'teacher' && u.active !== false);
    if (!teacher || !teacher.pendingSchoolId) fail(404, 'Pending school binding request not found');
    if (!isGlobalAdmin(user) && teacher.pendingSchoolId !== user.schoolId) fail(403, 'You do not have permission to review this request');
    if (reqMatch[2] === 'approve') {
      teacher.schoolId = teacher.pendingSchoolId;
    }
    delete teacher.pendingSchoolId;
    delete teacher.pendingSchoolRequestedAt;
    save();
    return json(res, 200, { user: publicUser(teacher), ok: true });
  }
  if (pathname === '/api/admin/courses' && method === 'POST') {
    requireAdmin(user);
    const rawIds = Array.isArray(body.teacherIds) ? body.teacherIds : body.teacherId ? [body.teacherId] : [];
    const teacherIds = [...new Set(rawIds.map(x => String(x || '').trim()).filter(Boolean))];
    if (!teacherIds.length) fail(400, 'Select at least one instructor for this course');
    for (const tid of teacherIds) {
      const t = db.users.find(u => u.id === tid && u.role === 'teacher' && u.active !== false);
      if (!t || !canAdminManage(user, t)) fail(400, 'Selected instructor is invalid or outside your school');
    }
    const classStudents = body.targetClassIds?.length ? resolveClassStudents(user, body.targetClassIds).students : [];
    const course = {
      id: id('course'), ...courseFields(body),
      teacherId: teacherIds[0], teacherIds,
      gradeWeights: { ...DEFAULT_WEIGHTS },
      lessons: [], announcements: [], createdAt: now(), updatedAt: now(),
    };
    db.courses.push(course); ensureCourseChatRoom(course);
    const autoEnrolled = autoEnrollStudents(course, db.users.filter(u => u.role === 'student' && u.active !== false));
    const classEnrolled = enrollStudentsIntoCourse(course, classStudents);
    save();
    return json(res, 201, { course: serializeCourse(course, user), autoEnrolledCount: autoEnrolled, classEnrolledCount: classEnrolled });
  }
  let adminCourseMatch = pathname.match(/^\/api\/admin\/courses\/([^/]+)$/);
  if (adminCourseMatch && method === 'PATCH') {
    requireAdmin(user);
    const course = courseById(adminCourseMatch[1]);
    const existingTeachers = courseTeacherIds(course).map(tid => db.users.find(u => u.id === tid)).filter(Boolean);
    if (!isGlobalAdmin(user) && !existingTeachers.some(t => canAdminManage(user, t))) fail(404, 'Course not found');
    const classStudents = body.targetClassIds !== undefined && body.targetClassIds.length ? resolveClassStudents(user, body.targetClassIds).students : [];
    Object.assign(course, courseFields(body, course));
    if (body.teacherIds !== undefined || body.teacherId !== undefined) {
      const rawIds = Array.isArray(body.teacherIds) ? body.teacherIds : body.teacherId ? [body.teacherId] : [];
      const teacherIds = [...new Set(rawIds.map(x => String(x || '').trim()).filter(Boolean))];
      if (!teacherIds.length) fail(400, 'Select at least one instructor for this course');
      for (const tid of teacherIds) {
        const t = db.users.find(u => u.id === tid && u.role === 'teacher' && u.active !== false);
        if (!t || !canAdminManage(user, t)) fail(400, 'Selected instructor is invalid or outside your school');
      }
      course.teacherId = teacherIds[0];
      course.teacherIds = teacherIds;
    }
    const autoEnrolled = autoEnrollStudents(course, db.users.filter(u => u.role === 'student' && u.active !== false));
    const classEnrolled = enrollStudentsIntoCourse(course, classStudents);
    course.updatedAt = now();
    save();
    return json(res, 200, { course: serializeCourse(course, user), autoEnrolledCount: autoEnrolled, classEnrolledCount: classEnrolled });
  }
  let enrollClassesMatch = pathname.match(/^\/api\/admin\/courses\/([^/]+)\/enroll-classes$/);
  if (enrollClassesMatch && method === 'POST') {
    requireAdmin(user);
    const course = courseById(enrollClassesMatch[1]);
    const existingTeachers = courseTeacherIds(course).map(tid => db.users.find(u => u.id === tid)).filter(Boolean);
    if (!isGlobalAdmin(user) && !existingTeachers.some(t => canAdminManage(user, t))) fail(404, 'Course not found');
    const { classes, students } = resolveClassStudents(user, body.classIds || body.targetClassIds || []);
    if (!classes.length) fail(400, 'Select at least one class');
    const enrolledCount = enrollStudentsIntoCourse(course, students);
    save();
    return json(res, 200, { enrolledCount, classCount: classes.length, studentCount: students.length, students: students.map(publicUser) });
  }
  let duplicateCourseMatch = pathname.match(/^\/api\/admin\/courses\/([^/]+)\/duplicate$/);
  if (duplicateCourseMatch && method === 'POST') {
    requireAdmin(user);
    const source = courseById(duplicateCourseMatch[1]);
    const sourceTeachers = courseTeacherIds(source).map(tid => db.users.find(u => u.id === tid)).filter(Boolean);
    if (!isGlobalAdmin(user) && !sourceTeachers.some(t => canAdminManage(user, t))) fail(404, 'Course not found');
    const copy = cloneCourseForAdmin(source);
    save();
    return json(res, 201, { course: serializeCourse(copy, user) });
  }
  if (adminCourseMatch && method === 'DELETE') {
    requireAdmin(user);
    const course = courseById(adminCourseMatch[1]);
    const existingTeachers = courseTeacherIds(course).map(tid => db.users.find(u => u.id === tid)).filter(Boolean);
    if (!isGlobalAdmin(user) && !existingTeachers.some(t => canAdminManage(user, t))) fail(404, 'Course not found');
    db.courses = db.courses.filter(c => c.id !== course.id);
    db.enrollments = db.enrollments.filter(e => e.courseId !== course.id);
    db.quizzes = db.quizzes.filter(q => q.courseId !== course.id);
    db.attempts = db.attempts.filter(a => a.courseId !== course.id);
    db.posts = db.posts.filter(pt => pt.courseId !== course.id);
    db.assignments = db.assignments.filter(a => a.courseId !== course.id);
    db.submissions = db.submissions.filter(s => s.courseId !== course.id);
    db.grades = db.grades.filter(g => g.courseId !== course.id);
    save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/teachers' && method === 'POST') {
    requireAdmin(user);
    const name = safeText(body.name, 'Name', 60);
    const email = safeText(body.email, 'Email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address');
    if (db.users.some(u => u.email.toLowerCase() === email)) fail(409, 'This email is already registered');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) fail(400, 'Password must contain 8–128 characters');
    const accountId = body.accountId != null && body.accountId !== '' ? validateRoleAccountId('teacher', body.accountId) : null;
    if (accountId && accountIdTaken(accountId)) fail(409, 'This account ID is already registered');
    const position = normalizePosition(body.position);
    const department = safeText(body.department ?? '', 'Department', 80, false);
    const major = safeText(body.major ?? '', 'Major', 80, false);
    const grade = safeText(body.grade ?? '', 'Grade', 40, false);
    const crossGrades = normalizeListValue(body.crossGrades ?? [], 'Cross grade', 40);
    const teacher = { id: id('user'), role: 'teacher', position, department, major, grade, crossGrades, name, email, studentId: null, accountId, schoolId: isGlobalAdmin(user) ? null : user.schoolId, passwordHash: hashPassword(body.password), active: true, createdAt: now() };
    db.users.push(teacher); save(); return json(res, 201, { user: publicUser(teacher) });
  }
  let teacherPosMatch = pathname.match(/^\/api\/admin\/teachers\/([^/]+)\/position$/);
  if (teacherPosMatch && method === 'PATCH') {
    requireAdmin(user);
    const teacher = db.users.find(u => u.id === teacherPosMatch[1] && u.role === 'teacher');
    if (!teacher || !canAdminManage(user, teacher)) fail(404, 'Instructor account not found');
    teacher.position = normalizePosition(body.position);
    save();
    return json(res, 200, { user: publicUser(teacher) });
  }
  let adminMatch = pathname.match(/^\/api\/admin\/teachers\/([^/]+)$/);
  if (adminMatch && method === 'DELETE') {
    requireAdmin(user);
    const teacher = db.users.find(u => u.id === adminMatch[1] && u.role === 'teacher');
    if (!teacher || !canAdminManage(user, teacher)) fail(404, 'Instructor account not found');
    teacher.active = false; invalidateSessions(teacher.id); save();
    return json(res, 200, { ok: true });
  }
  adminMatch = pathname.match(/^\/api\/admin\/teachers\/([^/]+)\/restore$/);
  if (adminMatch && method === 'POST') {
    requireAdmin(user);
    const teacher = db.users.find(u => u.id === adminMatch[1] && u.role === 'teacher');
    if (!teacher || !canAdminManage(user, teacher)) fail(404, 'Instructor account not found');
    teacher.active = true; save();
    return json(res, 200, { user: publicUser(teacher) });
  }
  adminMatch = pathname.match(/^\/api\/admin\/teachers\/([^/]+)\/permanent$/);
  if (adminMatch && method === 'DELETE') {
    requireAdmin(user);
    const idx = db.users.findIndex(u => u.id === adminMatch[1] && u.role === 'teacher');
    if (idx < 0 || !canAdminManage(user, db.users[idx])) fail(404, 'Instructor account not found');
    const teacher = db.users[idx];
    const soleCourses = db.courses.filter(c => c.teacherId === teacher.id && (!Array.isArray(c.teacherIds) || c.teacherIds.filter(id => id !== teacher.id).length === 0));
    if (soleCourses.length) fail(409, 'This instructor still owns ' + soleCourses.length + ' course(s). Reassign or delete those courses first.');
    for (const c of db.courses) {
      if (Array.isArray(c.teacherIds)) {
        c.teacherIds = c.teacherIds.filter(id => id !== teacher.id);
        if (c.teacherId === teacher.id && c.teacherIds.length) c.teacherId = c.teacherIds[0];
      }
    }
    invalidateSessions(teacher.id);
    removeUpload(teacher.avatarFile);
    db.users.splice(idx, 1);
    save();
    return json(res, 200, { ok: true });
  }
  adminMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
  if (adminMatch && method === 'PATCH') {
    requireAdmin(user);
    const target = db.users.find(u => u.id === adminMatch[1] && ['teacher', 'student'].includes(u.role));
    if (!target || !canAdminManage(user, target)) fail(404, 'Account not found');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) fail(400, 'Password must contain 8–128 characters');
    target.passwordHash = hashPassword(body.password); invalidateSessions(target.id); save();
    return json(res, 200, { ok: true });
  }
  adminMatch = pathname.match(/^\/api\/admin\/students\/([^/]+)\/enrollments\/([^/]+)$/);
  if (adminMatch && ['POST', 'DELETE'].includes(method)) {
    requireAdmin(user);
    const student = db.users.find(u => u.id === adminMatch[1] && u.role === 'student' && u.active !== false);
    if (!student || !canAdminManage(user, student)) fail(404, 'Student account not found');
    const course = courseById(adminMatch[2]);
    const courseTeacher = db.users.find(u => u.id === course.teacherId && u.role === 'teacher');
    if (!courseTeacher || !canAdminManage(user, courseTeacher)) fail(404, 'Course not found');
    if (method === 'POST') {
      if (!enrollment(student.id, course.id)) db.enrollments.push({ id: id('enrollment'), userId: student.id, courseId: course.id, completedLessonIds: [], createdAt: now(), lastActiveAt: now() });
    } else {
      db.enrollments = db.enrollments.filter(e => !(e.userId === student.id && e.courseId === course.id));
      db.grades = db.grades.filter(g => !(g.userId === student.id && g.courseId === course.id));
    }
    save(); return json(res, 200, { ok: true });
  }
  if (pathname === '/api/courses' && method === 'GET') return json(res, 200, { courses: db.courses.map(c => serializeCourse(c, user)) });
  if (pathname === '/api/courses/enroll-by-code' && method === 'POST') {
    requireRole(user, 'student');
    const code = safeText(body.code, 'Enrollment code', 20).toUpperCase();
    const course = db.courses.find(c => c.enrollmentCode === code);
    if (!course) fail(404, 'Invalid enrollment code');
    if (!enrollment(user.id, course.id)) {
      db.enrollments.push({ id: id('enrollment'), userId: user.id, courseId: course.id, completedLessonIds: [], createdAt: now(), lastActiveAt: now() });
      recentActivity('enrolled', user.id, course.id, course.title); save();
    }
    return json(res, 200, { course: serializeCourse(course, user) });
  }
  if (pathname === '/api/courses' && method === 'POST') {
    requireRole(user, 'teacher');
    const course = { id: id('course'), ...courseFields(body), teacherId: user.id, lessons: [], createdAt: now(), updatedAt: now(), gradePublication: { status: 'published', publishedAt: now(), publishedBy: user.id, snapshot: null } };
    db.courses.push(course); ensureCourseChatRoom(course); recentActivity('course_created', user.id, course.id, course.title); save();
    return json(res, 201, { course: serializeCourse(course, user) });
  }
  if (pathname === '/api/student/grades' && method === 'GET') {
    requireRole(user, 'student');
    const courses = db.enrollments.filter(e => e.userId === user.id).map(e => db.courses.find(c => c.id === e.courseId)).filter(Boolean)
      .map(course => ({ courseId: course.id, courseTitle: course.title, ...publishedGradeFor(course, user.id), ...studentGradeDetails(course, user.id) }));
    return json(res, 200, { courses });
  }
  let match = pathname.match(/^\/api\/courses\/([^/]+)\/assignments$/);
  if (match) {
    const course = courseById(match[1]); canStudy(user, course);
    if (method === 'GET') return json(res, 200, { assignments: db.assignments.filter(a => a.courseId === course.id).map(a => serializeAssignment(a, user)) });
    if (method === 'POST') {
      ownedCourse(user, course);
      const assignment = { id: id('assignment'), courseId: course.id, ...assignmentFields(body), createdAt: now(), updatedAt: now() };
      db.assignments.push(assignment); save();
      return json(res, 201, { assignment: serializeAssignment(assignment, user) });
    }
  }
  match = pathname.match(/^\/api\/assignments\/([^/]+)$/);
  if (match && ['PATCH', 'DELETE'].includes(method)) {
    const assignment = assignmentById(match[1]);
    const course = ownedCourse(user, courseById(assignment.courseId));
    if (method === 'PATCH') {
      Object.assign(assignment, assignmentFields(body, assignment), { updatedAt: now() }); save();
      return json(res, 200, { assignment: serializeAssignment(assignment, user) });
    }
    const removed = db.submissions.filter(s => s.assignmentId === assignment.id);
    for (const submission of removed) removeUpload(submission.file);
    db.submissions = db.submissions.filter(s => s.assignmentId !== assignment.id);
    db.assignments = db.assignments.filter(a => a.id !== assignment.id);
    save(); return json(res, 200, { ok: true });
  }
  match = pathname.match(/^\/api\/assignments\/([^/]+)\/submit$/);
  if (match && method === 'POST') {
    requireRole(user, 'student');
    const assignment = assignmentById(match[1]); const course = courseById(assignment.courseId); canStudy(user, course);
    const content = safeText(body.content ?? '', 'Assignment content', 10000, false);
    let submission = db.submissions.find(s => s.assignmentId === assignment.id && s.userId === user.id);
    if (!submission) {
      submission = { id: id('submission'), assignmentId: assignment.id, courseId: course.id, userId: user.id, content, file: null, score: null, feedback: '', submittedAt: now(), gradedAt: null };
      db.submissions.push(submission);
    } else {
      if (submission.submittedAt) (submission.history ||= []).push({ score: submission.score, feedback: submission.feedback, submittedAt: submission.submittedAt, gradedAt: submission.gradedAt });
      removeUpload(submission.file); submission.file = null;
      Object.assign(submission, { content, score: null, feedback: '', submittedAt: now(), gradedAt: null });
    }
    recentActivity('assignment_submitted', user.id, course.id, assignment.title);
    enrollment(user.id, course.id).lastActiveAt = now(); save();
    return json(res, 200, { submission: serializeSubmission(submission) });
  }
  match = pathname.match(/^\/api\/assignments\/([^/]+)\/submissions$/);
  if (match && method === 'GET') {
    const assignment = assignmentById(match[1]); ownedCourse(user, courseById(assignment.courseId));
    return json(res, 200, { submissions: db.submissions.filter(s => s.assignmentId === assignment.id).map(serializeSubmission) });
  }
  match = pathname.match(/^\/api\/assignments\/([^/]+)\/submission\/file$/);
  if (match && method === 'POST') {
    requireRole(user, 'student');
    const assignment = assignmentById(match[1]); const course = courseById(assignment.courseId); canStudy(user, course);
    const submission = db.submissions.find(s => s.assignmentId === assignment.id && s.userId === user.id);
    if (!submission) fail(400, 'Submit the written assignment content first');
    const mime = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
    const allowed = { 'application/pdf': '.pdf', 'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'text/plain': '.txt', 'image/png': '.png', 'image/jpeg': '.jpg' };
    const extension = allowed[mime]; if (!extension) fail(415, 'Only PDF, Word, text, or image assignment files are supported');
    const buffer = await readBinary(req, MAX_ASSIGNMENT_FILE);
    const upload = await saveUpload(buffer, req, extension);
    removeUpload(submission.file);
    if (submission.score != null) (submission.history ||= []).push({ score: submission.score, feedback: submission.feedback, submittedAt: submission.submittedAt, gradedAt: submission.gradedAt });
    Object.assign(submission, { file: upload, score: null, feedback: '', gradedAt: null, submittedAt: now() });
    enrollment(user.id, course.id).lastActiveAt = now(); save();
    return json(res, 200, { submission: serializeSubmission(submission) });
  }
  match = pathname.match(/^\/api\/submissions\/([^/]+)\/file$/);
  if (match && method === 'GET') {
    requireUser(user);
    const submission = db.submissions.find(s => s.id === match[1]); if (!submission) fail(404, 'Assignment file not found');
    const assignment = assignmentById(submission.assignmentId); const course = courseById(assignment.courseId);
    if (['teacher', 'admin'].includes(user.role)) ownedCourse(user, course);
    else if (submission.userId !== user.id || !enrollment(user.id, course.id)) fail(403, 'You cannot access another student’s assignment file');
    return streamUpload(req, res, submission.file);
  }
  match = pathname.match(/^\/api\/submissions\/([^/]+)\/grade$/);
  if (match && method === 'PATCH') {
    const submission = db.submissions.find(s => s.id === match[1]); if (!submission) fail(404, 'Assignment submission not found');
    const assignment = assignmentById(submission.assignmentId); ownedCourse(user, courseById(assignment.courseId));
    const score = Number(body.score);
    if (!Number.isFinite(score) || score < 0 || score > assignment.maxScore) fail(400, 'Assignment score is outside the valid range');
    Object.assign(submission, { score, feedback: safeText(body.feedback ?? '', 'Instructor feedback', 3000, false), gradedAt: now() }); save();
    return json(res, 200, { submission: serializeSubmission(submission) });
  }
  const GRADE_IMPORT_HEADER_MAP = {
    '学号': 'studentId', '学生账号': 'studentId', 'studentid': 'studentId', 'student_id': 'studentId',
    '账号': 'accountId', 'accountid': 'accountId', 'account_id': 'accountId', 'account': 'accountId',
    '邮箱': 'email', 'email': 'email', '姓名': 'name', '名字': 'name', 'name': 'name',
    '平时分': 'usual', '平时成绩': 'usual', '日常表现': 'usual', 'usual': 'usual',
    '测验': 'quiz', '测验成绩': 'quiz', '课堂检测': 'quiz', 'quiz': 'quiz',
    '期中': 'midterm', '期中成绩': 'midterm', '期中考试': 'midterm', 'midterm': 'midterm',
    '期末': 'final', '期末成绩': 'final', '期末考试': 'final', 'final': 'final',
    '课程': 'courseTitle', '课程名称': 'courseTitle', 'coursetitle': 'courseTitle',
    '课程代码': 'courseCode', 'coursecode': 'courseCode', '课程编号': 'courseCode',
  };
  function gradeRowsToObjects(rows) {
    if (!rows.length) fail(400, 'Imported file is empty');
    const headers = rows[0].map(h => {
      const raw = String(h ?? '').trim();
      return GRADE_IMPORT_HEADER_MAP[raw] || GRADE_IMPORT_HEADER_MAP[raw.toLowerCase()] || '';
    });
    if (!headers.includes('studentId') && !headers.includes('accountId') && !headers.includes('email') && !headers.includes('name')) {
      fail(400, `Missing student identifier column. Received headers: ${rows[0].map(h => h || '(blank)').join(', ')}`);
    }
    const scoreKeys = headers.filter(h => GRADE_KEYS.includes(h));
    if (!scoreKeys.length) fail(400, 'Missing grade column. Use 平时分 / 测验 / 期中 / 期末 (or usual / quiz / midterm / final)');
    return rows.slice(1).filter(row => row.some(cell => String(cell ?? '').trim())).map(row => Object.fromEntries(headers.map((h, i) => [h, String(row[i] ?? '').trim()]).filter(([h]) => h)));
  }
  function findGradeStudent(item) {
    const identifier = String(item.studentId || item.accountId || item.email || '').trim().toLowerCase();
    if (identifier) {
      const found = db.users.find(u => u.role === 'student' && u.active !== false && (
        String(u.studentId || '').toLowerCase() === identifier ||
        String(u.accountId || '').toLowerCase() === identifier ||
        String(u.email || '').toLowerCase() === identifier
      ));
      if (found) return found;
    }
    if (item.name) return db.users.find(u => u.role === 'student' && u.active !== false && String(u.name).trim() === String(item.name).trim()) || null;
    return null;
  }
  function gradeCourseFromRow(item, courses) {
    const code = String(item.courseCode || '').trim().toLowerCase();
    const title = String(item.courseTitle || '').trim();
    if (!code && !title) return null;
    return courses.find(c => code && [c.code, c.courseCode, c.enrollmentCode].some(v => String(v || '').toLowerCase() === code))
      || courses.find(c => title && String(c.title).trim() === title) || null;
  }
  function applyGradeItems(course, items) {
    const result = { imported: 0, updated: 0, skipped: 0, errors: [] };
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const student = findGradeStudent(item);
      if (!student) { result.skipped++; result.errors.push(`第 ${index + 2} 行：找不到学生 ${item.studentId || item.accountId || item.name || ''}`); continue; }
      if (!enrollment(student.id, course.id)) { result.skipped++; result.errors.push(`第 ${index + 2} 行：${student.name} 未选修该课程`); continue; }
      let grade = db.grades.find(g => g.courseId === course.id && g.userId === student.id);
      const nextScores = { ...(grade?.scores || {}) };
      let changed = 0;
      for (const key of GRADE_KEYS) {
        const raw = item[key];
        if (raw === undefined || raw === '' || raw === '-' || raw === '—') continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0 || value > 100) { result.errors.push(`第 ${index + 2} 行：${student.name} 的 ${key} 分数需在 0–100 之间`); continue; }
        nextScores[key] = value; changed++;
      }
      if (!changed) { result.skipped++; continue; }
      if (!grade) { grade = { id: id('grade'), courseId: course.id, userId: student.id, scores: nextScores, createdAt: now() }; db.grades.push(grade); result.imported++; }
      else { grade.scores = nextScores; grade.updatedAt = now(); result.updated++; }
    }
    return result;
  }
  function publishCourseGrades(course, actor) {
    const snapshot = db.enrollments.filter(e => e.courseId === course.id).map(e => {
      const student = db.users.find(u => u.id === e.userId && u.role === 'student');
      if (!student) return null;
      const g = gradeFor(course, student.id);
      return { userId: student.id, studentId: student.studentId || '', name: student.name, scores: g.scores, sources: g.sources, total: g.total, weights: g.weights };
    }).filter(Boolean);
    course.gradePublication = { status: 'published', publishedAt: now(), publishedBy: actor?.id || null, snapshot };
    return snapshot.length;
  }
  function draftCourseGrades(course) {
    course.gradePublication = { status: 'draft', publishedAt: null, publishedBy: null, snapshot: null };
  }
  const gradeImportCourses = () => db.courses.filter(c => isGlobalAdmin(user) || !c.schoolId || c.schoolId === user.schoolId);

  match = pathname.match(/^\/api\/courses\/([^/]+)\/gradebook\/import\/template$/);
  if (match && method === 'GET') {
    const course = ownedCourse(user, courseById(match[1]));
    const students = db.enrollments.filter(e => e.courseId === course.id).map(e => db.users.find(u => u.id === e.userId && u.role === 'student')).filter(Boolean);
    const headers = ['学号', '姓名', '平时分', '测验', '期中', '期末'];
    const rows = students.map(st => {
      const g = gradeFor(course, st.id);
      return [st.studentId || st.accountId || '', st.name, g.scores.usual ?? '', g.scores.quiz ?? '', g.scores.midterm ?? '', g.scores.final ?? ''];
    });
    if (!rows.length) rows.push(['20260001', '示例学生', '85', '90', '88', '92']);
    const format = String(url.searchParams.get('format') || 'csv').toLowerCase();
    const content = format === 'json'
      ? JSON.stringify(rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]]))), null, 2)
      : (format === 'tsv' ? [headers, ...rows].map(r => r.join('\t')).join('\r\n') : '\uFEFF' + [headers, ...rows].map(r => r.join(',')).join('\r\n'));
    const ext = ['json', 'tsv'].includes(format) ? format : 'csv';
    const type = format === 'json' ? 'application/json; charset=utf-8' : format === 'tsv' ? 'text/tab-separated-values; charset=utf-8' : 'text/csv; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${course.title.replace(/[\\/:*?"<>|]/g, '_')}-grades.${ext}"`, 'Cache-Control': 'no-store' });
    res.end(content);
    return;
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/gradebook\/import$/);
  if (match && method === 'POST') {
    const course = ownedCourse(user, courseById(match[1]));
    const items = gradeRowsToObjects(parseImportRows(body));
    const result = applyGradeItems(course, items);
    draftCourseGrades(course);
    save();
    return json(res, 200, { ok: true, ...result, publication: publicGradePublication(course) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/gradebook\/publish$/);
  if (match && method === 'POST') {
    const course = ownedCourse(user, courseById(match[1]));
    const count = publishCourseGrades(course, user);
    save();
    return json(res, 200, { ok: true, publishedCount: count, publication: publicGradePublication(course) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/gradebook\/unpublish$/);
  if (match && method === 'POST') {
    const course = ownedCourse(user, courseById(match[1]));
    draftCourseGrades(course);
    save();
    return json(res, 200, { ok: true, publication: publicGradePublication(course) });
  }
  if (pathname === '/api/admin/grades/status' && method === 'GET') {
    requireAdmin(user);
    return json(res, 200, { courses: gradeImportCourses().map(c => ({ courseId: c.id, title: c.title, ...publicGradePublication(c) })) });
  }
  if (pathname === '/api/admin/grades/import' && method === 'POST') {
    requireAdmin(user);
    const items = gradeRowsToObjects(parseImportRows(body));
    const courses = gradeImportCourses();
    let course = body.courseId ? courses.find(c => c.id === body.courseId) : null;
    if (body.courseId && !course) fail(404, 'Course not found');
    const grouped = new Map();
    for (const item of items) {
      const target = course || gradeCourseFromRow(item, courses);
      if (!target) continue;
      (grouped.get(target.id) || grouped.set(target.id, []).get(target.id)).push(item);
    }
    if (!grouped.size) fail(400, 'No rows matched a course. Add 课程名称 or 课程代码 column, or pass courseId.');
    const results = [];
    for (const [courseId, list] of grouped) {
      const target = courses.find(c => c.id === courseId);
      const result = applyGradeItems(target, list);
      draftCourseGrades(target);
      results.push({ courseId, title: target.title, ...result });
    }
    save();
    return json(res, 200, { ok: true, results });
  }
  if (pathname === '/api/admin/grades/publish' && method === 'POST') {
    requireAdmin(user);
    const courses = gradeImportCourses().filter(c => !Array.isArray(body.courseIds) || body.courseIds.includes(c.id));
    const results = courses.map(c => ({ courseId: c.id, title: c.title, publishedCount: publishCourseGrades(c, user) }));
    save();
    return json(res, 200, { ok: true, results });
  }
  if (pathname === '/api/admin/grades/unpublish' && method === 'POST') {
    requireAdmin(user);
    const courses = gradeImportCourses().filter(c => !Array.isArray(body.courseIds) || body.courseIds.includes(c.id));
    for (const c of courses) draftCourseGrades(c);
    save();
    return json(res, 200, { ok: true, count: courses.length });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/gradebook$/);
  if (match && method === 'GET') {
    const course = ownedCourse(user, courseById(match[1]));
    const students = db.enrollments.filter(e => e.courseId === course.id).map(e => {
      const student = db.users.find(u => u.id === e.userId);
      return student ? { userId: student.id, name: student.name, studentId: student.studentId, ...gradeFor(course, student.id) } : null;
    }).filter(Boolean);
    return json(res, 200, { weights: course.gradeWeights || DEFAULT_WEIGHTS, students, publication: publicGradePublication(course) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/gradebook\/weights$/);
  if (match && method === 'PUT') {
    const course = ownedCourse(user, courseById(match[1]));
    course.gradeWeights = validateWeights(body.weights); save();
    return json(res, 200, { weights: course.gradeWeights });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/gradebook\/([^/]+)$/);
  if (match && method === 'PATCH') {
    const course = ownedCourse(user, courseById(match[1]));
    const student = db.users.find(u => u.id === match[2] && u.role === 'student');
    if (!student || !enrollment(student.id, course.id)) fail(404, 'This student is not enrolled in the course');
    if (!body.scores || typeof body.scores !== 'object' || Array.isArray(body.scores)) fail(400, 'Invalid grade format');
    let grade = db.grades.find(g => g.courseId === course.id && g.userId === student.id);
    const nextScores = { ...(grade?.scores || {}) };
    for (const key of GRADE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(body.scores, key)) continue;
      const value = body.scores[key];
      if (value === '' || value == null) { delete nextScores[key]; continue; }
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 100) fail(400, 'Grades must be between 0 and 100');
      nextScores[key] = number;
    }
    if (!grade) { grade = { id: id('grade'), courseId: course.id, userId: student.id, scores: nextScores }; db.grades.push(grade); }
    else grade.scores = nextScores;
    save(); return json(res, 200, { userId: student.id, ...gradeFor(course, student.id) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)$/);
  if (match) {
    const course = courseById(match[1]);
    if (method === 'GET') return json(res, 200, { course: serializeCourse(course, user) });
    ownedCourse(user, course);
    if (method === 'PATCH') { Object.assign(course, courseFields(body, course), { updatedAt: now() }); save(); return json(res, 200, { course: serializeCourse(course, user) }); }
    if (method === 'DELETE') {
      for (const cf of course.files || []) removeUpload(cf);
      for (const lesson of course.lessons) { removeUpload(lesson.videoFile); for (const lf of lesson.files || []) removeUpload(lf); for (const folder of lesson.resourceFolders || []) for (const file of folder.files || []) removeUpload(file); }
      const assignmentIds = new Set(db.assignments.filter(a => a.courseId === course.id).map(a => a.id));
      for (const submission of db.submissions.filter(s => assignmentIds.has(s.assignmentId))) removeUpload(submission.file);
      db.assignments = db.assignments.filter(a => a.courseId !== course.id);
      db.submissions = db.submissions.filter(s => !assignmentIds.has(s.assignmentId));
      db.grades = db.grades.filter(g => g.courseId !== course.id);
      db.courses = db.courses.filter(c => c.id !== course.id);
      db.quizzes = db.quizzes.filter(q => q.courseId !== course.id);
      const lessonQuizIds = (db.lessonQuizzes || []).filter(q => q.courseId === course.id).map(q => q.id);
      db.lessonQuizzes = (db.lessonQuizzes || []).filter(q => q.courseId !== course.id);
      db.lessonQuizAttempts = (db.lessonQuizAttempts || []).filter(a => !lessonQuizIds.includes(a.quizId));
      db.enrollments = db.enrollments.filter(e => e.courseId !== course.id);
      db.attempts = db.attempts.filter(a => a.courseId !== course.id);
      db.posts = db.posts.filter(p => p.courseId !== course.id);
      db.activity = db.activity.filter(a => a.courseId !== course.id); save();
      return json(res, 200, { ok: true });
    }
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/lessons$/);
  if (match && method === 'POST') {
    const course = ownedCourse(user, courseById(match[1]));
    const lesson = { id: id('lesson'), ...lessonFields(body), order: course.lessons.length, createdAt: now() };
    course.lessons.push(lesson); course.updatedAt = now(); save();
    return json(res, 201, { lesson, course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)$/);
  if (match && ['PATCH','DELETE'].includes(method)) {
    const course = db.courses.find(c => c.lessons.some(l => l.id === match[1]));
    if (!course) fail(404, 'Lesson not found');
    ownedCourse(user, course);
    const lesson = course.lessons.find(l => l.id === match[1]);
    if (method === 'PATCH') { Object.assign(lesson, lessonFields(body, lesson)); course.updatedAt = now(); save(); return json(res, 200, { lesson, course: serializeCourse(course, user) }); }
    removeUpload(lesson.videoFile);
    for (const lf of lesson.files || []) removeUpload(lf);
    for (const folder of lesson.resourceFolders || []) for (const file of folder.files || []) removeUpload(file);
    course.lessons = course.lessons.filter(l => l.id !== lesson.id).map((l, order) => ({ ...l, order }));
    for (const e of db.enrollments.filter(e => e.courseId === course.id)) e.completedLessonIds = e.completedLessonIds.filter(x => x !== lesson.id);
    course.updatedAt = now(); save(); return json(res, 200, { ok: true });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/folders$/);
  if (match && ['GET', 'POST'].includes(method)) {
    const { course, lesson } = courseByLesson(match[1]);
    if (method === 'GET') { canStudy(user, course); return json(res, 200, { folders: publicFolders(lesson) }); }
    ownedCourse(user, course);
    if ((lesson.resourceFolders || []).length >= 30) fail(400, 'A lesson supports at most 30 resource folders');
    const name = safeText(body.name, 'Folder name', 100);
    if (/[\/\\\x00-\x1f]/.test(name) || name === '.' || name === '..') fail(400, 'Invalid folder name');
    if ((lesson.resourceFolders || []).some(f => f.name.toLowerCase() === name.toLowerCase())) fail(409, 'This folder name is already used');
    const folder = { id: id('folder'), name, files: [], createdAt: now() };
    (lesson.resourceFolders ||= []).push(folder); course.updatedAt = now(); save();
    return json(res, 201, { folder: publicFolder(folder) });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/folders\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const { course, lesson } = courseByLesson(match[1]); ownedCourse(user, course);
    const folder = folderById(lesson, match[2]);
    for (const file of folder.files || []) removeUpload(file);
    lesson.resourceFolders = lesson.resourceFolders.filter(f => f.id !== folder.id); course.updatedAt = now(); save();
    return json(res, 200, { ok: true });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/folders\/([^/]+)\/files$/);
  if (match && method === 'POST') {
    const { course, lesson } = courseByLesson(match[1]); ownedCourse(user, course);
    const folder = folderById(lesson, match[2]);
    if (folder.files.length >= MAX_FOLDER_FILES) fail(400, 'A folder supports at most 50 files');
    const { originalName, ext: extension } = validateGeneralFileUpload(req);
    if (folder.files.some(file => file.name.toLowerCase() === originalName.toLowerCase())) fail(409, 'A file with this name already exists in the folder');
    const buffer = await readBinary(req, MAX_GENERAL_FILE);
    const uploaded = await saveUpload(buffer, req, extension);
    const file = { id: id('resource'), ...uploaded, createdAt: now() };
    folder.files.push(file); course.updatedAt = now();
    try { save(); } catch (error) { folder.files.pop(); removeUpload(file); throw error; }
    return json(res, 201, { file: { id: file.id, name: file.name, size: file.size, mimeType: file.mimeType } });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/folders\/([^/]+)\/files\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const { course, lesson } = courseByLesson(match[1]); ownedCourse(user, course);
    const folder = folderById(lesson, match[2]);
    const file = folder.files.find(f => f.id === match[3]);
    if (!file) fail(404, 'File not found');
    folder.files = folder.files.filter(f => f.id !== file.id); removeUpload(file); course.updatedAt = now(); save();
    return json(res, 200, { ok: true });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/folders\/([^/]+)\/download$/);
  if (match && method === 'GET') {
    const { course, lesson } = courseByLesson(match[1]); canStudy(user, course);
    const folder = folderById(lesson, match[2]);
    await Promise.all((folder.files || []).map(f => ensureLocalFile(f.storedName)));
    return streamZip(res, folder.files || [], UPLOAD_DIR, folder.name);
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/files$/);
  if (match && method === 'POST') {
    const course = ownedCourse(user, courseById(match[1]));
    const { originalName, ext } = validateGeneralFileUpload(req);
    const buffer = await readBinary(req, MAX_GENERAL_FILE);
    const uploaded = await saveUpload(buffer, req, ext);
    const fileItem = { id: id('cfile'), ...uploaded, name: originalName, createdAt: now() };
    (course.files ||= []).push(fileItem);
    course.updatedAt = now();
    try { save(); } catch (err) { course.files.pop(); removeUpload(fileItem); throw err; }
    return json(res, 201, { file: publicAttachment(fileItem), course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/files\/([^/]+)$/);
  if (match && ['GET', 'DELETE'].includes(method)) {
    const course = courseById(match[1]);
    if (method === 'GET') {
      canStudy(user, course);
      const fileItem = (course.files || []).find(f => f.id === match[2]);
      if (!fileItem) fail(404, 'Course file not found');
      const isInline = ['.mp4', '.webm', '.ogg', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.mp3', '.wav', '.m4a'].some(e => fileItem.name.toLowerCase().endsWith(e));
      return streamUpload(req, res, fileItem, isInline);
    }
    ownedCourse(user, course);
    const fileItem = (course.files || []).find(f => f.id === match[2]);
    if (!fileItem) fail(404, 'Course file not found');
    course.files = course.files.filter(f => f.id !== fileItem.id);
    removeUpload(fileItem);
    course.updatedAt = now();
    save();
    return json(res, 200, { ok: true, course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/files$/);
  if (match && method === 'POST') {
    const { course, lesson } = courseByLesson(match[1]);
    ownedCourse(user, course);
    const { originalName, ext } = validateGeneralFileUpload(req);
    const buffer = await readBinary(req, MAX_GENERAL_FILE);
    const uploaded = await saveUpload(buffer, req, ext);
    const fileItem = { id: id('lfile'), ...uploaded, name: originalName, createdAt: now() };
    (lesson.files ||= []).push(fileItem);
    course.updatedAt = now();
    try { save(); } catch (err) { lesson.files.pop(); removeUpload(fileItem); throw err; }
    return json(res, 201, { file: publicAttachment(fileItem), course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/files\/([^/]+)$/);
  if (match && ['GET', 'DELETE'].includes(method)) {
    const { course, lesson } = courseByLesson(match[1]);
    if (method === 'GET') {
      canStudy(user, course);
      const fileItem = (lesson.files || []).find(f => f.id === match[2]);
      if (!fileItem) fail(404, 'Lesson file not found');
      const isInline = ['.mp4', '.webm', '.ogg', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.mp3', '.wav', '.m4a'].some(e => fileItem.name.toLowerCase().endsWith(e));
      return streamUpload(req, res, fileItem, isInline);
    }
    ownedCourse(user, course);
    const fileItem = (lesson.files || []).find(f => f.id === match[2]);
    if (!fileItem) fail(404, 'Lesson file not found');
    lesson.files = lesson.files.filter(f => f.id !== fileItem.id);
    removeUpload(fileItem);
    course.updatedAt = now();
    save();
    return json(res, 200, { ok: true, course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/video$/);
  if (match && ['GET', 'POST'].includes(method)) {
    const course = db.courses.find(c => c.lessons.some(l => l.id === match[1]));
    if (!course) fail(404, 'Lesson not found');
    const lesson = course.lessons.find(l => l.id === match[1]);
    if (method === 'GET') { canStudy(user, course); return streamUpload(req, res, lesson.videoFile, true); }
    ownedCourse(user, course);
    const mime = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
    const allowed = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv' };
    const extension = allowed[mime]; if (!extension) fail(415, 'Only MP4, WebM, or Ogg videos are supported');
    const buffer = await readBinary(req, MAX_VIDEO);
    const upload = await saveUpload(buffer, req, extension);
    removeUpload(lesson.videoFile);
    lesson.videoFile = upload; lesson.type = 'video'; course.updatedAt = now(); save();
    return json(res, 200, { lesson: serializeCourse(course, user).lessons.find(l => l.id === lesson.id), course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/enroll$/);
  if (match && method === 'POST') {
    requireRole(user, 'student'); const course = courseById(match[1]);
    if (safeText(body.code, 'Enrollment code', 20).toUpperCase() !== course.enrollmentCode) fail(403, 'Incorrect enrollment code');
    if (!enrollment(user.id, course.id)) {
      db.enrollments.push({ id: id('enrollment'), userId: user.id, courseId: course.id, completedLessonIds: [], createdAt: now(), lastActiveAt: now() });
      recentActivity('enrolled', user.id, course.id, course.title); save();
    }
    return json(res, 200, { course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/unenroll$/);
  if (match && method === 'POST') {
    requireRole(user, 'student');
    const course = courseById(match[1]);
    db.enrollments = db.enrollments.filter(e => !(e.userId === user.id && e.courseId === course.id));
    save();
    return json(res, 200, { course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/complete$/);
  if (match && method === 'POST') {
    requireRole(user, 'student');
    const course = db.courses.find(c => c.lessons.some(l => l.id === match[1]));
    if (!course) fail(404, 'Lesson not found');
    const e = enrollment(user.id, course.id); if (!e) fail(403, 'Enroll in the course first');
    if (!e.completedLessonIds.includes(match[1])) e.completedLessonIds.push(match[1]);
    e.lastActiveAt = now(); recentActivity('lesson_completed', user.id, course.id, course.lessons.find(l => l.id === match[1]).title); save();
    return json(res, 200, { course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/quiz$/);
  if (match) {
    const { course, lesson } = courseByLesson(match[1]);
    if (method === 'GET') {
      canStudy(user, course);
      const quiz = lessonQuizByLesson(lesson.id);
      if (!quiz) return json(res, 200, { quiz: null, attempts: [] });
      const setIndex = ['teacher', 'admin'].includes(user.role) ? null : quizSetFor(user, course);
      const attempts = (db.lessonQuizAttempts || []).filter(a => a.quizId === quiz.id && a.userId === user.id)
        .map(({ id: attemptId, score, total, percent, correct, totalQuestions, submittedAt }) => ({ id: attemptId, score, total, percent, correct, totalQuestions, submittedAt }))
        .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
      return json(res, 200, { quiz: serializeLessonQuiz(quiz, user, setIndex), attempts });
    }
    if (['PUT', 'DELETE'].includes(method)) {
      ownedCourse(user, course);
      if (method === 'DELETE') {
        const removedIds = (db.lessonQuizAttempts || []).filter(a => a.quizId === lessonQuizByLesson(lesson.id)?.id).map(a => a.id);
        db.lessonQuizzes = (db.lessonQuizzes || []).filter(q => q.lessonId !== lesson.id);
        db.lessonQuizAttempts = (db.lessonQuizAttempts || []).filter(a => !removedIds.includes(a.id));
        save(); return json(res, 200, { ok: true });
      }
      if (!Array.isArray(db.lessonQuizzes)) db.lessonQuizzes = [];
      if (!Array.isArray(db.lessonQuizAttempts)) db.lessonQuizAttempts = [];
      const fields = validateLessonQuiz(body);
      let quiz = lessonQuizByLesson(lesson.id);
      if (!quiz) {
        quiz = { id: id('lquiz'), courseId: course.id, lessonId: lesson.id, ...fields, createdAt: now(), updatedAt: now() };
        db.lessonQuizzes.push(quiz);
      } else {
        Object.assign(quiz, fields, { updatedAt: now() });
      }
      save(); return json(res, 200, { quiz: serializeLessonQuiz(quiz, user, null) });
    }
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/quiz\/submit$/);
  if (match && method === 'POST') {
    requireRole(user, 'student');
    const { course, lesson } = courseByLesson(match[1]); canStudy(user, course);
    const quiz = lessonQuizByLesson(lesson.id);
    if (!quiz || !quiz.questions.length) fail(404, 'No quiz has been set up for this lesson');
    const setIndex = quizSetFor(user, course);
    const questions = quiz.questions.filter(q => q.setIndex === setIndex);
    if (!questions.length) fail(400, 'No questions are assigned to your student set');
    if (!Array.isArray(body.answers)) fail(400, 'Submit an array of answers');
    const answerMap = new Map(body.answers.map(a => [a.questionId, a.optionIndex]));
    let score = 0;
    let total = 0;
    let correct = 0;
    for (const q of questions) {
      const points = Number(q.points || 0);
      total += points;
      if (answerMap.get(q.id) === q.correctIndex) { score += points; correct += 1; }
    }
    const percent = Math.round(correct / questions.length * 100);
    const attempt = { id: id('lqattempt'), quizId: quiz.id, courseId: course.id, lessonId: lesson.id, userId: user.id, setIndex, score: Math.round(score * 100) / 100, total: Math.round(total * 100) / 100, percent, correct, totalQuestions: questions.length, submittedAt: now() };
    if (!Array.isArray(db.lessonQuizAttempts)) db.lessonQuizAttempts = [];
    db.lessonQuizAttempts.push(attempt);
    enrollment(user.id, course.id).lastActiveAt = now();
    recentActivity('quiz_submitted', user.id, course.id, `${lesson.title} · ${percent}%`);
    save();
    return json(res, 201, { attempt });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/quiz$/);
  if (match) {
    const course = courseById(match[1]); canStudy(user, course);
    let quiz = quizByCourse(course.id);
    if (method === 'GET') {
      const attempts = user.role === 'student' ? db.attempts.filter(a => a.userId === user.id && a.courseId === course.id).map(({ id, score, total, percent, submittedAt }) => ({ id, score, total, percent, submittedAt })) : [];
      return json(res, 200, { quiz: serializeQuiz(quiz, user), attempts });
    }
    if (method === 'PUT') {
      ownedCourse(user, course);
      const questions = validateQuiz(body.questions);
      if (!quiz) { quiz = { id: id('quiz'), courseId: course.id, title: `${course.title} · Knowledge Check`, questions, updatedAt: now() }; db.quizzes.push(quiz); }
      else { quiz.questions = questions; quiz.updatedAt = now(); }
      save(); return json(res, 200, { quiz: serializeQuiz(quiz, user) });
    }
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/quiz\/submit$/);
  if (match && method === 'POST') {
    requireRole(user, 'student'); const course = courseById(match[1]); canStudy(user, course);
    const quiz = quizByCourse(course.id); if (!quiz || !quiz.questions.length) fail(404, 'No quiz has been set up for this course');
    if (!Array.isArray(body.answers)) fail(400, 'Submit an array of answers');
    const answerMap = new Map(body.answers.map(a => [a.questionId, a.optionIndex]));
    const score = quiz.questions.filter(q => answerMap.get(q.id) === q.correctIndex).length;
    const attempt = { id: id('attempt'), quizId: quiz.id, courseId: course.id, userId: user.id, score, total: quiz.questions.length, percent: Math.round(score / quiz.questions.length * 100), submittedAt: now() };
    db.attempts.push(attempt); enrollment(user.id, course.id).lastActiveAt = now(); recentActivity('quiz_submitted', user.id, course.id, `${attempt.percent}%`); save();
    return json(res, 201, { attempt: { id: attempt.id, score, total: attempt.total, percent: attempt.percent, submittedAt: attempt.submittedAt } });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/announcements$/);
  if (match && method === 'POST') {
    const course = ownedCourse(user, courseById(match[1]));
    const title = safeText(body.title, 'Announcement title', 120);
    const content = safeText(body.content, 'Announcement content', 5000);
    if (!Array.isArray(course.announcements)) course.announcements = [];
    const announcement = { id: id('cann'), title, content, authorId: user.id, authorName: user.name, createdAt: now() };
    course.announcements.unshift(announcement);
    course.updatedAt = now();
    save();
    return json(res, 201, { announcement, course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/announcements\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const course = ownedCourse(user, courseById(match[1]));
    if (!Array.isArray(course.announcements)) course.announcements = [];
    const idx = course.announcements.findIndex(a => a.id === match[2]);
    if (idx < 0) fail(404, 'Course announcement not found');
    course.announcements.splice(idx, 1);
    course.updatedAt = now();
    save();
    return json(res, 200, { ok: true });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/discussions$/);
  if (match) {
    const course = courseById(match[1]); canStudy(user, course);
    if (method === 'GET') {
      ensureCourseChatRoom(course);
      const posts = db.posts
        .filter(p => p.courseId === course.id)
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(p => {
          const author = db.users.find(u => u.id === p.authorId);
          return {
            ...p,
            avatarUrl: author?.avatarFile ? `/api/profile/avatar/${encodeURIComponent(author.id)}` : ''
          };
        });
      const memberCount = db.enrollments.filter(e => e.courseId === course.id).length + courseTeacherIds(course).length;
      return json(res, 200, { posts, memberCount });
    }
    if (method === 'POST') {
      const content = safeText(body.content, 'Discussion content', 2000);
      const post = { id: id('post'), courseId: course.id, authorId: user.id, authorName: user.name, authorRole: user.role, content, createdAt: now() };
      db.posts.push(post); recentActivity('discussion', user.id, course.id, content.slice(0, 80)); save();
      return json(res, 201, {
        post: {
          ...post,
          avatarUrl: user.avatarFile ? `/api/profile/avatar/${encodeURIComponent(user.id)}` : ''
        }
      });
    }
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/discussions\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const course = courseById(match[1]); canStudy(user, course);
    const post = db.posts.find(p => p.courseId === course.id && p.id === match[2]);
    if (!post) fail(404, 'Discussion post not found');
    if (post.authorId !== user.id && !canManageCourse(user, course)) fail(403, 'You can only delete your own discussion posts');
    db.posts = db.posts.filter(p => p.id !== post.id); save(); return json(res, 200, { ok: true });
  }
  if (pathname === '/api/teacher/subordinates' && method === 'GET') {
    requireRole(user, 'teacher');
    const pos = normalizePosition(user.position);
    const subTeachers = db.users
      .filter(u => u.role === 'teacher' && u.id !== user.id && canInspectSubordinate(user, u))
      .map(t => {
        const tCourses = db.courses.filter(c => isCourseTeacher(t, c));
        const tCourseIds = new Set(tCourses.map(c => c.id));
        const tEnrolls = db.enrollments.filter(e => tCourseIds.has(e.courseId));
        return {
          ...publicUser(t),
          courseCount: tCourses.length,
          studentCount: new Set(tEnrolls.map(e => e.userId)).size,
          courses: tCourses.map(c => ({ id: c.id, title: c.title, studentCount: db.enrollments.filter(e => e.courseId === c.id).length }))
        };
      })
      .sort((a, b) => (b.positionRank - a.positionRank) || a.name.localeCompare(b.name));
    const subStudents = db.users
      .filter(u => u.role === 'student' && canInspectSubordinate(user, u))
      .map(s => {
        const sCourses = visibleCoursesForTeacher(user);
        const details = sCourses.map(c => studentEnrollmentDetails(s, c)).filter(Boolean);
        return {
          ...publicUser(s),
          enrollments: details,
          avgProgress: details.length ? Math.round(details.reduce((acc, e) => acc + e.progress, 0) / details.length) : 0
        };
      });
    const scopeDesc = pos === '校长' ? '全校所有副校长、院长、副院长、教务处长、课题组长、教师及全校学生'
      : pos === '副校长' ? '全校分管院系院长、副院长、教务处长、课题组长、教师及学生'
      : pos === '院长' ? `本院（${user.department || '未分配院系'}）副院长、课题组长、全体教师及本院学生`
      : pos === '副院长' ? `本院（${user.department || '未分配院系'}）课题组长、教学教师及本院学生`
      : pos === '教务处长' ? '全校教学运行、课题组长、任课教师及全校选课学情'
      : pos === '课题组长' ? `本教研组/课题组（${user.department || '未分配院系'}）下属教师及所授课程学生`
      : '本人所授课程及选课学生';
    return json(res, 200, {
      position: pos,
      positionRank: positionRankOf(user),
      scopeDescription: scopeDesc,
      teachers: subTeachers,
      students: subStudents,
      courses: visibleCoursesForTeacher(user).map(c => serializeCourse(c, user))
    });
  }
  if (pathname === '/api/teacher/overview' && method === 'GET') {
    requireRole(user, 'teacher');
    const courses = visibleCoursesForTeacher(user);
    const courseIds = new Set(courses.map(c => c.id));
    const enrollments = db.enrollments.filter(e => courseIds.has(e.courseId));
    const enrolledStudentIds = new Set(enrollments.map(e => e.userId));
    const students = db.users.filter(u => u.role === 'student' && enrolledStudentIds.has(u.id));
    const attempts = db.attempts.filter(a => courseIds.has(a.courseId));
    const courseStats = courses.map(c => {
      const e = enrollments.filter(x => x.courseId === c.id);
      const a = attempts.filter(x => x.courseId === c.id);
      const tNames = courseTeacherIds(c).map(tid => db.users.find(u => u.id === tid)?.name).filter(Boolean).join(', ');
      return { id: c.id, title: c.title, teacherName: tNames, isMine: isCourseTeacher(user, c), enrollments: e.length, avgProgress: e.length ? Math.round(e.reduce((s,x) => s + progressFor(x.userId,c).progress,0)/e.length) : 0, avgQuizScore: a.length ? Math.round(a.reduce((s,x) => s+x.percent,0)/a.length) : null };
    });
    const avgCompletion = enrollments.length ? Math.round(enrollments.reduce((s,e) => s + progressFor(e.userId, courses.find(c => c.id === e.courseId)).progress,0)/enrollments.length) : 0;
    const avgQuizScore = attempts.length ? Math.round(attempts.reduce((s,a) => s+a.percent,0)/attempts.length) : null;
    const recent = db.activity.filter(a => courseIds.has(a.courseId)).slice(0,10).map(a => ({ ...a, userName: db.users.find(u => u.id === a.userId)?.name || 'User', courseTitle: courses.find(c => c.id === a.courseId)?.title || '' }));
    const subordinateCount = db.users.filter(u => u.role === 'teacher' && u.id !== user.id && canInspectSubordinate(user, u)).length;
    return json(res, 200, { position: normalizePosition(user.position), stats: { totalStudents: students.length, totalCourses: courses.length, totalEnrollments: enrollments.length, avgCompletion, avgQuizScore, subordinateCount }, courses: courseStats, recentActivity: recent });
  }
  if (pathname === '/api/teacher/students' && method === 'GET') {
    requireRole(user, 'teacher');
    const courses = visibleCoursesForTeacher(user);
    const courseIds = new Set(courses.map(c => c.id));
    const enrolledStudentIds = new Set(db.enrollments.filter(e => courseIds.has(e.courseId)).map(e => e.userId));
    const students = db.users.filter(u => u.role === 'student' && (enrolledStudentIds.has(u.id) || canInspectSubordinate(user, u))).map(u => {
      const details = courses.map(c => studentEnrollmentDetails(u,c)).filter(Boolean);
      return { id: u.id, name: u.name, email: u.email, studentId: u.studentId, department: u.department || '', major: u.major || '', enrollments: details,
        avgProgress: details.length ? Math.round(details.reduce((s,e) => s+e.progress,0)/details.length) : 0,
        lastActiveAt: details.map(e => e.lastActiveAt).filter(Boolean).sort().at(-1) || null };
    });
    return json(res, 200, { students });
  }
  fail(404, 'API endpoint not found');
}

const LESSON_QUIZ_FRONTEND = "\n/* LESSON_QUIZ_FRONTEND_PATCH - standalone, no dependency on v2.js internals */\n(() => {\n  if (window.__lessonQuizPatchLoaded) return;\n  window.__lessonQuizPatchLoaded = true;\n  state.lessonQuiz = null;\n  state.lessonQuizAttempts = [];\n  state.lessonQuizFor = null;\n  state.lessonQuizLoading = false;\n  state.lessonQuizShowForm = true;\n\n  const isTeacher = () => ['teacher', 'admin'].includes(state.user?.role);\n  const lessonById = id => state.selectedCourse?.lessons?.find(l => l.id === id);\n\n  function lessonQuizPanel(lessonId) {\n    if (state.lessonQuizFor !== lessonId || state.lessonQuizLoading) {\n      return '<div class=\"lesson-resources\" style=\"margin-top:14px;padding-top:14px\"><h4 style=\"margin:0 0 8px\">✅ 本节课检测</h4><p class=\"small muted\">Loading lesson check…</p></div>';\n    }\n    const quiz = state.lessonQuiz;\n    if (!quiz) {\n      return isTeacher() ? '<div class=\"lesson-resources\" style=\"margin-top:14px;padding-top:14px\"><div class=\"row-between\"><div><h4 style=\"margin:0 0 8px\">✅ 本节课检测</h4><p class=\"small muted\">这节课还没有配置检测题库。</p></div><button type=\"button\" class=\"btn btn-primary btn-sm\" data-action=\"import-lesson-quiz\" data-id=\"' + esc(lessonId) + '\">导入课时检测题库</button></div></div>' : '';\n    }\n    const attempts = state.lessonQuizAttempts || [];\n    const latest = attempts[0];\n    if (isTeacher()) {\n      return '<div class=\"lesson-resources\" style=\"margin-top:14px;padding-top:14px\"><div class=\"row-between wrap\"><div><h4 style=\"margin:0 0 8px\">✅ 本节课检测</h4><p class=\"small muted\" style=\"margin:0\">题库 ' + quiz.totalQuestions + ' 题 · 25 套独立卷 · 每套 20 题 · 满分 ' + quiz.maxPoints + ' 分</p></div><div class=\"row wrap\"><button type=\"button\" class=\"btn btn-soft btn-sm\" data-action=\"import-lesson-quiz\" data-id=\"' + esc(lessonId) + '\">导入/更新题库</button><button type=\"button\" class=\"btn btn-danger btn-sm\" data-action=\"delete-lesson-quiz\" data-id=\"' + esc(lessonId) + '\">删除检测</button></div></div></div>';\n    }\n    const header = '<h4 style=\"margin:0 0 8px\">✅ 本节课检测</h4><p class=\"small muted\" style=\"margin:0 0 12px\">共 ' + quiz.totalQuestions + ' 题，满分 ' + quiz.maxPoints + ' 分；提交后自动评分并计入课堂检测成绩。</p>';\n    if (!state.lessonQuizShowForm && latest) {\n      const history = attempts.slice(0, 5).map(a => '<div class=\"lesson-file-row\"><span>' + fmtDate(a.submittedAt) + ' · ' + a.correct + '/' + a.totalQuestions + ' 题正确</span><b>' + esc(a.score) + ' / ' + esc(a.total) + ' 分（' + a.percent + '%）</b></div>').join('');\n      return '<div class=\"lesson-resources\" style=\"margin-top:14px;padding-top:14px\">' + header + '<div class=\"panel\" style=\"padding:12px\"><strong>最近一次成绩：' + esc(latest.score) + ' / ' + esc(latest.total) + ' 分（' + latest.percent + '%）</strong></div><div style=\"margin-top:10px\">' + history + '</div><button type=\"button\" class=\"btn btn-soft btn-sm\" style=\"margin-top:12px\" data-action=\"retake-lesson-quiz\" data-id=\"' + esc(lessonId) + '\">重新作答</button></div>';\n    }\n    const questions = (quiz.questions || []).map((q, index) => {\n      const options = (q.options || []).map((opt, k) => '<label class=\"lesson-quiz-option\" style=\"display:block;margin:5px 0\"><input type=\"radio\" name=\"q-' + esc(q.id) + '\" value=\"' + k + '\" required> ' + String.fromCharCode(65 + k) + '. ' + esc(opt) + '</label>').join('');\n      return '<div class=\"lesson-quiz-question\" style=\"margin-bottom:14px\"><strong>' + (index + 1) + '. ' + esc(q.text) + '</strong><div style=\"margin-top:6px\">' + options + '</div></div>';\n    }).join('');\n    return '<form id=\"lesson-quiz-form\" class=\"lesson-resources\" data-lesson-id=\"' + esc(lessonId) + '\" style=\"margin-top:14px;padding-top:14px\">' + header + questions + '<button type=\"submit\" class=\"btn btn-primary btn-sm\">提交并自动评分</button></form>';\n  }\n\n  function lessonQuizImportModal() {\n    const lessonId = state.modal?.lessonId || state.activeLesson;\n    return '<div class=\"modal-backdrop\" data-action=\"close-modal\"><div class=\"modal wide\" role=\"dialog\" aria-modal=\"true\"><div class=\"modal-head\"><h2>导入课时检测题库</h2><button class=\"icon-btn\" type=\"button\" data-action=\"close-modal\" aria-label=\"Close\">✕</button></div><form id=\"lesson-quiz-import-form\" data-lesson-id=\"' + esc(lessonId) + '\"><div class=\"modal-body\"><p class=\"small muted\">粘贴题库 JSON，必须包含 25 套，每套 20 题。</p><div class=\"field\"><label for=\"lesson-quiz-json\">题库 JSON</label><textarea id=\"lesson-quiz-json\" rows=\"12\" required></textarea></div></div><div class=\"modal-actions\"><button class=\"btn btn-light\" type=\"button\" data-action=\"close-modal\">Cancel</button><button class=\"btn btn-primary\" type=\"submit\">保存题库</button></div></form></div></div>';\n  }\n\n  async function refreshLessonQuiz(lessonId) {\n    state.lessonQuizFor = lessonId;\n    state.lessonQuizLoading = true;\n    state.lessonQuiz = null;\n    state.lessonQuizAttempts = [];\n    state.lessonQuizShowForm = true;\n    if (state.activeLesson === lessonId) render();\n    try {\n      const data = await api('/api/lessons/' + encodeURIComponent(lessonId) + '/quiz');\n      if (state.lessonQuizFor !== lessonId) return;\n      state.lessonQuiz = data.quiz || null;\n      state.lessonQuizAttempts = data.attempts || [];\n    } finally {\n      if (state.lessonQuizFor === lessonId) {\n        state.lessonQuizLoading = false;\n        if (state.activeLesson === lessonId) render();\n      }\n    }\n  }\n\n  const baseLessonView = lessonView;\n  lessonView = function(course, lesson) {\n    let html = baseLessonView(course, lesson);\n    if (lesson && (isTeacher() || course.enrolled)) {\n      html = html.replace('</section>', lessonQuizPanel(lesson.id) + '</section>');\n      if (state.activeLesson === lesson.id && state.lessonQuizFor !== lesson.id && !state.lessonQuizLoading) {\n        setTimeout(() => refreshLessonQuiz(lesson.id), 0);\n      }\n    }\n    return html;\n  };\n\n  const baseModal = modal;\n  modal = function() {\n    if (state.modal?.type === 'lesson-quiz') return lessonQuizImportModal();\n    return baseModal();\n  };\n\n  window.addEventListener('click', event => {\n    const node = event.target.closest('[data-action]');\n    if (!node || !state.user) return;\n    const action = node.dataset.action;\n    const id = node.dataset.id;\n    if (action === 'open-lesson') {\n      setTimeout(() => { if (state.activeLesson === id) refreshLessonQuiz(id); }, 0);\n      return;\n    }\n    if (action === 'import-lesson-quiz') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      state.modal = { type: 'lesson-quiz', lessonId: id };\n      render();\n      return;\n    }\n    if (action === 'delete-lesson-quiz') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      if (!confirm('确定删除这节课的检测题库和所有作答记录吗？')) return;\n      run(async () => {\n        await api('/api/lessons/' + encodeURIComponent(id) + '/quiz', { method: 'DELETE' });\n        await refreshLessonQuiz(id);\n        showToast('课时检测已删除');\n      }, '删除失败: ');\n      return;\n    }\n    if (action === 'retake-lesson-quiz') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      state.lessonQuizShowForm = true;\n      render();\n      return;\n    }\n  }, true);\n\n  window.addEventListener('submit', event => {\n    const form = event.target;\n    if (form.id === 'lesson-quiz-import-form') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      const lessonId = form.dataset.lessonId;\n      let payload;\n      try { payload = JSON.parse(document.getElementById('lesson-quiz-json').value); }\n      catch (error) { showToast('JSON 格式不正确', true); return; }\n      run(async () => {\n        await api('/api/lessons/' + encodeURIComponent(lessonId) + '/quiz', { method: 'PUT', body: JSON.stringify(payload) });\n        state.modal = null;\n        await refreshLessonQuiz(lessonId);\n        showToast('课时检测题库已保存');\n      }, '保存课时检测失败: ');\n      return;\n    }\n    if (form.id === 'lesson-quiz-form') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      const lessonId = form.dataset.lessonId;\n      const answers = Array.from(form.querySelectorAll('input[type=\"radio\"]:checked')).map(input => ({\n        questionId: input.name.slice(2),\n        optionIndex: Number(input.value)\n      }));\n      if (!answers.length) { showToast('请完成所有题目', true); return; }\n      run(async () => {\n        const data = await api('/api/lessons/' + encodeURIComponent(lessonId) + '/quiz/submit', { method: 'POST', body: JSON.stringify({ answers }) });\n        await refreshLessonQuiz(lessonId);\n        state.lessonQuizShowForm = false;\n        render();\n        showToast('已自动评分：' + data.attempt.score + ' / ' + data.attempt.total + ' 分（' + data.attempt.percent + '%）');\n      }, '提交检测失败: ');\n      return;\n    }\n  }, true);\n})();\n";
const ADMIN_JS_PATCHED = "// Administrator workspace and email password recovery. Loaded after the standard UI extensions.\n(() => {\n  const originalAuthPage = authPage;\n  const originalRender = render;\n  let resetToken = new URLSearchParams(location.search).get('reset') || '';\n  let resetNotice = '';\n  let adminData = null;\n  let adminLoading = false;\n  let adminError = '';\n  let adminTab = 'teachers';\n  let adminDialog = null;\n  let deptDialogUser = null;\n  let annEditItem = null;\n  let courseEditItem = null;\n  let courseStudentsModal = null;\n  let classEditItem = null;\n  let courseFilter = { q: '', department: '', teacherId: '', academicYear: '', discipline: '', groupBy: 'department' };\n  let courseSubTab = 'courses';\n  let classFilter = { q: '', department: '', grade: '' };\n  let teacherFilter = { q: '', department: '', major: '', status: '', position: '' };\n  let studentFilter = { q: '', department: '', major: '', gender: '', classId: '' };\n\n  if (resetToken) {\n    // Never leave the one-use token visible in browser history after opening the email link.\n    history.replaceState(null, '', location.pathname + location.hash);\n    state.authMode = 'reset';\n  }\n\n  function authRecoveryPage() {\n    const resetting = state.authMode === 'reset';\n    const heading = resetting ? 'Set a New Password' : 'Forgot Your Password?';\n    const explanation = resetting\n      ? 'Choose a new password for your account. The link in your email can only be used once.'\n      : 'Enter your account email. If it is registered, we will send a password reset link.';\n    const fields = resetting\n      ? '<div class=\"field\"><label for=\"new-password\">New Password</label><input id=\"new-password\" name=\"password\" type=\"password\" minlength=\"8\" maxlength=\"128\" autocomplete=\"new-password\" required></div>' +\n        '<div class=\"field\"><label for=\"confirm-password\">Confirm New Password</label><input id=\"confirm-password\" name=\"confirm\" type=\"password\" minlength=\"8\" maxlength=\"128\" autocomplete=\"new-password\" required></div>'\n      : '<div class=\"field\"><label for=\"recovery-email\">Email Address</label><input id=\"recovery-email\" name=\"email\" type=\"email\" placeholder=\"you@example.com\" autocomplete=\"email\" required></div>';\n    return '<div class=\"auth-layout\"><section class=\"auth-brand-panel\">' + brand() +\n      '<div class=\"auth-promo\"><div class=\"eyebrow\">ACCOUNT ACCESS</div><h1>Get back to learning.</h1><p>Secure account recovery for students, instructors, and administrators.</p></div>' +\n      '<footer>© ' + new Date().getFullYear() + ' Zhixing Learning</footer></section>' +\n      '<section class=\"auth-form-panel\"><div class=\"auth-topnav\"><button type=\"button\" data-admin-action=\"back-to-login\">Back to Sign In →</button></div>' +\n      '<div class=\"auth-form-wrap\"><div class=\"eyebrow\">ACCOUNT RECOVERY</div><h2>' + heading + '</h2><p class=\"intro\">' + explanation + '</p>' +\n      (resetNotice ? '<div class=\"panel panel-pad small\" role=\"status\" style=\"margin-bottom:17px\">' + esc(resetNotice) + '</div>' : '') +\n      '<form id=\"' + (resetting ? 'admin-reset-confirm' : 'admin-reset-request') + '\">' + fields +\n      '<button class=\"btn btn-primary auth-submit\" type=\"submit\">' + (resetting ? 'Save New Password' : 'Send Reset Link') + '</button></form>' +\n      '<p class=\"auth-bottom\">' + (resetting ? 'Need another link?' : 'Remembered your password?') +\n      ' <button type=\"button\" data-admin-action=\"' + (resetting ? 'forgot' : 'back-to-login') + '\">' +\n      (resetting ? 'Request a New Link' : 'Sign In') + '</button></p></div></section></div>';\n  }\n\n  authPage = function() {\n    if (state.authMode === 'forgot' || state.authMode === 'reset') return authRecoveryPage();\n    let html = originalAuthPage();\n    if (state.authMode === 'register') {\n      html = html.replace('</select>', '<option value=\"admin\"' + (state.authRole === 'admin' ? ' selected' : '') + '>⚙ Administrator</option></select>');\n      if (state.authRole !== 'admin') {\n        const schoolHint = state.authRole === 'teacher' ? 'Instructor school binding requires administrator approval. Leave blank to join later.' : 'For example: 1008611 or Peking University. You can join later from your profile.'; html = html.replace('<div class=\"field\"><label for=\"auth-email\">Email Address</label>', '<div class=\"field\"><label for=\"auth-school\">School / Organization (optional)</label><input id=\"auth-school\" name=\"school\" maxlength=\"100\" placeholder=\"Enter a school code or exact school name\"><div class=\"field-hint\">' + schoolHint + '</div></div><div class=\"field\"><label for=\"auth-email\">Email Address</label>');\n      } else {\n        html = html.replace('Create Your Teaching Workspace', 'Create a School Organization');\n        html = html.replace('Create an instructor account, then create courses and share enrollment codes with students.', 'Create your school organization and invite instructors and students with its code or exact name.');\n        html = html.replace('Instructor Account ID', 'Administrator Account ID');\n        html = html.replace('For example tch202601', 'For example SIU199901');\n        html = html.replace('Must start with tch followed by digits (e.g. tch202601).', 'Must start with an English letter using uppercase letters and digits (e.g. SIU199901).');\n        html = html.replace('<div class=\"field\"><label for=\"auth-email\">Email Address</label>', '<div class=\"field\"><label for=\"auth-stage\">学段 / Education Stage *</label><select id=\"auth-stage\" name=\"stage\" required><option value=\"kindergarten\">幼儿园</option><option value=\"primary\">小学</option><option value=\"middle\">中学</option><option value=\"vocational\">职业学校</option><option value=\"technical\">技工学校</option><option value=\"university\" selected>大学</option><option value=\"general\">普通教育教学机构</option></select><div class=\"field-hint\">大学课程必须使用课程代码；其他学段排课不需要课程代码。</div></div><div class=\"field\"><label for=\"auth-school-name\">School / Organization Name</label><input id=\"auth-school-name\" name=\"schoolName\" maxlength=\"100\" placeholder=\"For example, Peking University\" required></div><div class=\"field\"><label for=\"auth-school-code\">School Code (optional)</label><input id=\"auth-school-code\" name=\"schoolCode\" maxlength=\"16\" placeholder=\"For example, 1008611\"><div class=\"field-hint\">Each school and code can only register one administrator account. Leave blank to generate automatically.</div></div><div class=\"field\"><label for=\"auth-email\">Email Address</label>');\n        html = html.replace('Create Instructor Account →', 'Create School Administrator Account →');\n        html = html.replace('Already have an account?', 'Already have an administrator account?');\n      }\n    }\n    if (state.authMode === 'login') {\n      html = html.replace('</form><p class=\"auth-bottom\">', '</form><p class=\"auth-bottom\"><button type=\"button\" data-admin-action=\"forgot\">Forgot password?</button></p><p class=\"auth-bottom\">');\n    }\n    return html.replace('name@university.edu', 'you@example.com');\n  };\n\n  function startAdminLoad() {\n    if (adminData || adminLoading || adminError) return;\n    adminLoading = true;\n    api('/api/admin/overview').then(data => {\n      adminData = data;\n      adminError = '';\n    }).catch(error => {\n      adminError = error.message;\n    }).finally(() => {\n      adminLoading = false;\n      if (state.user?.role === 'admin') render();\n    });\n  }\n\n  function uniqueValues(items, key) {\n    return [...new Set((items || []).map(x => String(x[key] || '').trim()).filter(Boolean))].sort();\n  }\n  function matchesQuery(item, q) {\n    if (!q) return true;\n    const hay = [item.name, item.accountId, item.studentId, item.email, item.department, item.major, item.school?.name, item.school?.code].filter(Boolean).join(' ').toLowerCase();\n    return hay.includes(q.toLowerCase());\n  }\n\n  const TEACHER_POSITIONS = ['校长', '副校长', '院长', '副院长', '教务处长', '课题组长', '教师'];\n  const POSITION_BADGE_COLORS = {\n    '校长': 'background:#fef3c7;color:#b45309;border:1px solid #fcd34d',\n    '副校长': 'background:#ffedd5;color:#c2410c;border:1px solid #fdba74',\n    '院长': 'background:#ede9fe;color:#6d28d9;border:1px solid #c4b5fd',\n    '副院长': 'background:#e0e7ff;color:#4338ca;border:1px solid #a5b4fc',\n    '教务处长': 'background:#dcfce7;color:#15803d;border:1px solid #86efac',\n    '课题组长': 'background:#cffafe;color:#0e7490;border:1px solid #67e8f9',\n    '教师': 'background:#f1f5f9;color:#475569;border:1px solid #cbd5e1'\n  };\n  function positionOptionsHtml(selected) {\n    const cur = TEACHER_POSITIONS.includes(selected) ? selected : '教师';\n    return TEACHER_POSITIONS.map(p => '<option value=\"' + p + '\"' + (cur === p ? ' selected' : '') + '>' + p + '</option>').join('');\n  }\n\n  const ANN_CATEGORIES = { school: 'School Information (学校信息)', college: 'College Information (学院信息)', academic: 'Academic Affairs (教务管理)' };\n  const SCHOOL_STAGE_LABELS = { kindergarten: '幼儿园', primary: '小学', middle: '中学', vocational: '职业学校', technical: '技工学校', university: '大学', general: '普通教育教学机构' };\n  function departmentPanel() {\n    const depts = adminData?.departments || [];\n    const tags = depts.map(d => '<span class=\"pill blue\" style=\"display:inline-flex;align-items:center;gap:6px\">' + esc(d.name) +\n      (d.id ? '<button type=\"button\" data-admin-action=\"delete-dept\" data-id=\"' + esc(d.id) + '\" style=\"border:0;background:none;color:inherit;cursor:pointer;font-weight:800;padding:0\" title=\"Remove\">×</button>' : '') +\n      '</span>').join('');\n    return '<section class=\"panel panel-pad\" style=\"margin-bottom:20px\"><div class=\"row-between wrap\"><div><h2>Department Management (院系管理)</h2>' +\n      '<p class=\"small muted\">Manage departments for your school and assign instructors or students below.</p></div></div>' +\n      '<div class=\"row wrap\" style=\"gap:8px;margin:10px 0 14px\">' + (tags || '<span class=\"small muted\">No departments configured yet.</span>') + '</div>' +\n      '<form id=\"admin-add-dept-form\"><div class=\"row wrap\"><input name=\"name\" maxlength=\"80\" placeholder=\"Enter department name (e.g. 计算机学院)\" required style=\"max-width:320px\">' +\n      '<button type=\"submit\" class=\"btn btn-soft btn-sm\">+ Add Department</button></div></form></section>';\n  }\n  function classesTable() {\n    const classes = adminData?.classes || [];\n    const students = adminData?.students || [];\n    const depts = uniqueValues(classes, 'department');\n    const grades = uniqueValues(classes, 'grade');\n    const filtered = classes.filter(c => {\n      if (classFilter.q) {\n        const hay = [c.name, c.grade, c.department, c.academicYear].filter(Boolean).join(' ').toLowerCase();\n        if (!hay.includes(classFilter.q.toLowerCase())) return false;\n      }\n      if (classFilter.department && (c.department || '') !== classFilter.department) return false;\n      if (classFilter.grade && (c.grade || '') !== classFilter.grade) return false;\n      return true;\n    });\n    const studentOptions = students.map(s => '<option value=\"' + esc(s.id) + '\">' + esc(s.name) + ' (' + esc(s.studentId || s.email || 'No ID') + ')' + (s.department ? ' · ' + esc(s.department) : '') + (s.grade ? ' · ' + esc(s.grade) : '') + '</option>').join('');\n    const formHtml = '<section class=\"panel panel-pad\" style=\"margin-bottom:20px\"><h2>Create Class (新增班级)</h2>' +\n      '<p class=\"small muted\">Create a class roster, then select it when creating or editing a course to import all students at once.</p>' +\n      '<form id=\"admin-add-class-form\"><div class=\"form-grid\">' +\n      '<div class=\"field\"><label>班级名称 / Class Name *</label><input name=\"name\" maxlength=\"80\" placeholder=\"e.g. 2026教育学1班\" required></div>' +\n      '<div class=\"field\"><label>年级 / Grade</label><input name=\"grade\" maxlength=\"40\" placeholder=\"e.g. 2026级 / 三年级\"></div>' +\n      '<div class=\"field\"><label>学院 / Department</label><input name=\"department\" list=\"admin-class-dept-list\" maxlength=\"80\" placeholder=\"e.g. 教育学院\"><datalist id=\"admin-class-dept-list\">' + depts.map(d => '<option value=\"' + esc(d) + '\">').join('') + '</datalist></div>' +\n      '<div class=\"field\"><label>学年 / Academic Year</label><input name=\"academicYear\" maxlength=\"40\" placeholder=\"e.g. 2026-2027\"></div></div>' +\n      '<div class=\"field\"><label>班级学生 / Class Students（hold Cmd/Ctrl to select multiple）</label><select name=\"studentIds\" multiple size=\"6\" style=\"width:100%;min-height:120px\">' + studentOptions + '</select></div>' +\n      '<button type=\"submit\" class=\"btn btn-primary\">+ Add Class</button></form></section>';\n    const filterBar = '<div class=\"filter-line\" style=\"padding:0 20px 14px\"><div class=\"searchbar\"><span>⌕</span><input id=\"class-filter-q\" data-admin-filter=\"class-q\" type=\"search\" value=\"' + esc(classFilter.q) + '\" placeholder=\"Search class, grade, department, academic year\"></div>' +\n      '<div class=\"row wrap\"><select data-admin-filter=\"class-department\" aria-label=\"Filter classes by department\"><option value=\"\">All Departments</option>' + depts.map(d => '<option value=\"' + esc(d) + '\"' + (classFilter.department === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select>' +\n      '<select data-admin-filter=\"class-grade\" aria-label=\"Filter classes by grade\"><option value=\"\">All Grades</option>' + grades.map(g => '<option value=\"' + esc(g) + '\"' + (classFilter.grade === g ? ' selected' : '') + '>' + esc(g) + '</option>').join('') + '</select></div></div>';\n    const rows = filtered.map(c => '<tr><td><strong>' + esc(c.name) + '</strong><br><span class=\"tiny muted\">' + [c.grade, c.academicYear, c.department].filter(Boolean).map(esc).join(' · ') + '</span></td>' +\n      '<td><span class=\"pill blue\">' + n(c.studentCount) + ' students</span></td>' +\n      '<td>' + esc((c.students || []).slice(0, 5).map(s => s.name).join(', ') || '—') + ((c.studentCount || 0) > 5 ? ' …' : '') + '</td>' +\n      '<td><div class=\"row wrap\"><button type=\"button\" class=\"btn btn-soft btn-sm\" data-admin-action=\"edit-class\" data-id=\"' + esc(c.id) + '\">Edit / Students</button>' +\n      '<button type=\"button\" class=\"btn btn-danger btn-sm\" data-admin-action=\"delete-class\" data-id=\"' + esc(c.id) + '\">Delete</button></div></td></tr>').join('');\n    return formHtml + '<section class=\"panel\"><div class=\"panel-pad\"><h2>Class Management (班级管理) <span class=\"pill blue\">' + filtered.length + ' / ' + classes.length + '</span></h2>' +\n      '<p class=\"small muted\">Classes are reusable student groups for course enrollment and future scheduling.</p></div>' + filterBar +\n      '<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>Class</th><th>Students</th><th>Members</th><th>Actions</th></tr></thead><tbody>' +\n      (rows || '<tr><td colspan=\"4\">No classes yet. Create one above.</td></tr>') + '</tbody></table></div></section>';\n  }\n  function coursesTable() {\n    const subTabs = '<div class=\"row wrap\" style=\"margin-bottom:14px\"><button type=\"button\" class=\"btn ' + (courseSubTab === 'courses' ? 'btn-primary' : 'btn-light') + ' btn-sm\" data-admin-action=\"course-subtab\" data-tab=\"courses\">课程管理</button>' +\n      '<button type=\"button\" class=\"btn ' + (courseSubTab === 'classes' ? 'btn-primary' : 'btn-light') + ' btn-sm\" data-admin-action=\"course-subtab\" data-tab=\"classes\">班级管理</button></div>';\n    if (courseSubTab === 'classes') return subTabs + classesTable();\n    const allCourses = adminData?.courses || [];\n    const isUniversity = (adminData?.organization?.stage || 'university') === 'university';\n    const activeTeachers = (adminData?.teachers || []).filter(t => t.active);\n    const depts = [...new Set([...(adminData?.departments || []).map(d => d.name), ...activeTeachers.map(t => t.department).filter(Boolean)])].sort();\n    const teachersInDept = courseFilter.department ? activeTeachers.filter(t => (t.department || '') === courseFilter.department) : activeTeachers;\n    const filteredCourses = allCourses.filter(c => {\n      if (courseFilter.q) {\n        const hay = [c.title, c.category, c.enrollmentCode, c.teacherName, ...(c.departments || [])].filter(Boolean).join(' ').toLowerCase();\n        if (!hay.includes(courseFilter.q.toLowerCase())) return false;\n      }\n      if (courseFilter.department) {\n        const cDepts = new Set(c.departments || []);\n        const matchTeacherDept = (c.teacherIds || [c.teacherId]).some(tid => {\n          const t = activeTeachers.find(x => x.id === tid);\n          return t && (t.department || '') === courseFilter.department;\n        });\n        if (!cDepts.has(courseFilter.department) && !matchTeacherDept) return false;\n      }\n      if (courseFilter.teacherId) {\n        const tIds = c.teacherIds || [c.teacherId];\n        if (!tIds.includes(courseFilter.teacherId)) return false;\n      }\n      if (courseFilter.academicYear && (c.academicYear || '') !== courseFilter.academicYear) return false;\n      if (courseFilter.discipline && (c.category || '') !== courseFilter.discipline) return false;\n      return true;\n    });\n    const editing = courseEditItem;\n    const selectedIds = new Set(editing ? (editing.teacherIds || [editing.teacherId]) : []);\n    const teacherCheckboxes = activeTeachers.length\n      ? '<div style=\"display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;max-height:180px;overflow:auto;padding:10px;border:1px solid var(--border);border-radius:10px;background:#fafbfe\">' +\n        activeTeachers.map(t => '<label style=\"display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer\"><input type=\"checkbox\" name=\"teacherIds\" value=\"' + esc(t.id) + '\"' + (selectedIds.has(t.id) ? ' checked' : '') + '><span><strong>' + esc(t.name) + '</strong> <small class=\"muted\">(' + esc(t.department || 'Unassigned') + ')</small></span></label>').join('') +\n        '</div>'\n      : '<p class=\"small muted\">No active instructors available. Add or approve an instructor first.</p>';\n    const selectedTargetDepts = new Set(editing?.targetDepartments || []);\n    const targetDeptChecks = depts.length ? '<div style=\"display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;max-height:140px;overflow:auto;padding:8px;border:1px solid var(--border);border-radius:10px;background:#fafbfe\">' +\n      depts.map(d => '<label style=\"display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer\"><input type=\"checkbox\" name=\"targetDepartments\" value=\"' + esc(d) + '\"' + (selectedTargetDepts.has(d) ? ' checked' : '') + '><span>' + esc(d) + '</span></label>').join('') + '</div>' : '<p class=\"small muted\">No departments configured yet.</p>';\n    const allMajors = [...new Set((adminData?.students || []).map(s => s.major).filter(Boolean))].sort();\n    const formYears = [...new Set(allCourses.map(c => c.academicYear).filter(Boolean))].sort();\n    const classList = adminData?.classes || [];\n    const selectedTargetClasses = new Set(editing?.targetClassIds || []);\n    const targetClassChecks = classList.length ? '<div style=\"display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px;max-height:140px;overflow:auto;padding:8px;border:1px solid var(--border);border-radius:10px;background:#fafbfe\">' +\n      classList.map(c => '<label style=\"display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer\"><input type=\"checkbox\" name=\"targetClassIds\" value=\"' + esc(c.id) + '\"' + (selectedTargetClasses.has(c.id) ? ' checked' : '') + '><span><strong>' + esc(c.path || [c.department, c.major, c.name].filter(Boolean).join(' › ')) + '</strong> <small class=\"muted\">(' + n(c.studentCount) + ' students)</small></span></label>').join('') + '</div>' : '<p class=\"small muted\">No classes configured yet. Add classes in Class Management first.</p>';\n    const formHtml = '<section class=\"panel panel-pad\" style=\"margin-bottom:20px\"><h2>' + (editing ? 'Edit Course & Assigned Instructors' : 'Create Course & Assign Instructor(s)') + '</h2>' +\n      '<p class=\"small muted\">Administrators can create courses and assign one or multiple instructors to teach together.</p>' +\n      '<form id=\"admin-course-form\"' + (editing ? ' data-id=\"' + esc(editing.id) + '\"' : '') + '>' +\n      '<div class=\"form-grid\"><div class=\"field\"><label for=\"admin-course-title\">Course Name *</label><input id=\"admin-course-title\" name=\"title\" value=\"' + esc(editing?.title || '') + '\" maxlength=\"100\" placeholder=\"e.g. Introduction to AI\" required></div>' +\n      '<div class=\"field\"><label for=\"admin-course-category\">学科 / Category *</label><input id=\"admin-course-category\" name=\"category\" value=\"' + esc(editing?.category || 'General Studies') + '\" maxlength=\"40\" required></div>' +\n      '<div class=\"field\"><label for=\"admin-course-owner\">所属学院 / Owner College</label><select id=\"admin-course-owner\" name=\"ownerDepartment\"><option value=\"\">未指定</option>' + depts.map(d => '<option value=\"' + esc(d) + '\"' + ((editing?.ownerDepartment || '') === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select><div class=\"field-hint\">排课时按所属学院筛选和分配。</div></div>' +\n      '<div class=\"field\"><label for=\"admin-course-type\">课程类型 / Course Type</label><select id=\"admin-course-type\" name=\"courseType\"><option value=\"online\"' + ((editing?.courseType || 'online') === 'online' ? ' selected' : '') + '>在线学习课程（有课时与检测）</option><option value=\"normal\"' + (editing?.courseType === 'normal' ? ' selected' : '') + '>普通课程（仅用于排课，无网络学习）</option></select></div>' +\n      '<div class=\"field\"><label for=\"admin-course-cover\">课程封面</label><select id=\"admin-course-cover\" name=\"cover\">' + ['📘','📗','📕','📙','📚','🎓','🧪','💻','🎨','🏫'].map(e => '<option value=\"' + e + '\"' + ((editing?.cover || '📘') === e ? ' selected' : '') + '>' + e + '</option>').join('') + '</select></div>' +\n      '<div class=\"field\"><label for=\"admin-course-color\">主题色</label><input id=\"admin-course-color\" name=\"color\" type=\"color\" value=\"' + esc(editing?.color || '#6979dc') + '\"></div>' +\n      '<div class=\"field\"><label for=\"admin-course-cover-file\">上传封面图片（可选）</label><input id=\"admin-course-cover-file\" type=\"file\" accept=\"image/*\"><div class=\"field-hint\">不上传则自动生成封面。图片会保存在课程中，建议小于 3 MB。</div></div>' +\n      '<div class=\"field\"><label for=\"admin-course-code\">' + (isUniversity ? '课程代码 / Enrollment Code *' : '课程代码 / Enrollment Code（可选）') + '</label><input id=\"admin-course-code\" name=\"enrollmentCode\" value=\"' + esc(editing?.enrollmentCode || '') + '\" maxlength=\"20\"' + (isUniversity ? ' required' : '') + ' placeholder=\"' + (isUniversity ? '大学排课必须使用课程代码，留空将自动生成' : 'Leave blank to auto-generate') + '\"></div></div>' +\n      '<div class=\"field\"><label for=\"admin-course-desc\">Description *</label><textarea id=\"admin-course-desc\" name=\"description\" rows=\"2\" maxlength=\"2000\" placeholder=\"Course goals and overview…\" required>' + esc(editing?.description || '') + '</textarea></div>' +\n      '<div class=\"form-grid\"><div class=\"field\"><label for=\"admin-course-year\">学年 / Academic Year</label><input id=\"admin-course-year\" name=\"academicYear\" list=\"admin-course-years\" value=\"' + esc(editing?.academicYear || '') + '\" maxlength=\"40\" placeholder=\"e.g. 2026-2027\"></div>' +\n      '<div class=\"field\"><label for=\"admin-course-majors\">学科/专业（逗号分隔）</label><input id=\"admin-course-majors-text\" name=\"targetMajorsText\" list=\"admin-course-major-options\" value=\"' + esc((editing?.targetMajors || []).join(',')) + '\" maxlength=\"300\" placeholder=\"教育学,学前教育\"></div></div>' +\n      '<datalist id=\"admin-course-years\">' + formYears.map(y => '<option value=\"' + esc(y) + '\"></option>').join('') + '</datalist>' +\n      '<datalist id=\"admin-course-major-options\">' + allMajors.map(m => '<option value=\"' + esc(m) + '\"></option>').join('') + '</datalist>' +\n      '<div class=\"field\"><label>目标学院 / Target Departments（不选表示不限）</label>' + targetDeptChecks + '</div>' +\n      '<div class=\"field\"><label>按班级导入学生 / Import Students by Class（保存课程时执行一次）</label>' + targetClassChecks + '</div>' +\n      '<label class=\"small\" style=\"display:flex;align-items:center;gap:8px;margin:8px 0 14px;cursor:pointer\"><input type=\"checkbox\" name=\"autoEnroll\"' + (editing?.autoEnroll ? ' checked' : '') + '><span>自动同步符合条件的学生到本课程（Auto-enroll matching students）</span></label>' +\n      '<div class=\"field\"><label>Assign Instructor(s) * (multi-select)</label>' + teacherCheckboxes + '</div>' +\n      '<div class=\"row wrap\"><button type=\"submit\" class=\"btn btn-primary\">' + (editing ? 'Save Course Changes' : 'Create Course') + '</button>' +\n      (editing ? '<button type=\"button\" class=\"btn btn-light\" data-admin-action=\"cancel-edit-course\">Cancel</button>' : '') + '</div></form></section>';\n    const academicYears = [...new Set(allCourses.map(c => c.academicYear).filter(Boolean))].sort();\n    const disciplines = [...new Set(allCourses.map(c => c.category).filter(Boolean))].sort();\n    const filterBar = '<div class=\"filter-line\" style=\"display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:0 20px 14px\"><div class=\"searchbar\" style=\"flex:1 1 240px;min-width:200px\"><span>⌕</span><input id=\"course-filter-q\" data-admin-filter=\"course-q\" type=\"search\" value=\"' + esc(courseFilter.q) + '\" placeholder=\"搜索课程、代码、类别、教师\"></div>' +\n      '<select style=\"flex:1 1 170px;min-width:150px\" data-admin-filter=\"course-department\" aria-label=\"Filter by department\"><option value=\"\">All Departments (按学院筛选)</option>' + depts.map(d => '<option value=\"' + esc(d) + '\"' + (courseFilter.department === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select>' +\n      '<select style=\"flex:1 1 170px;min-width:150px\" data-admin-filter=\"course-teacher\" aria-label=\"Filter by instructor\"><option value=\"\">All Instructors (按老师筛选)</option>' + teachersInDept.map(t => '<option value=\"' + esc(t.id) + '\"' + (courseFilter.teacherId === t.id ? ' selected' : '') + '>' + esc(t.name) + (t.department ? ' · ' + esc(t.department) : '') + '</option>').join('') + '</select>' +\n      '<select style=\"flex:1 1 170px;min-width:150px\" data-admin-filter=\"course-year\" aria-label=\"Filter by academic year\"><option value=\"\">All Academic Years (全部学年)</option>' + academicYears.map(y => '<option value=\"' + esc(y) + '\"' + (courseFilter.academicYear === y ? ' selected' : '') + '>' + esc(y) + '</option>').join('') + '</select>' +\n      '<select style=\"flex:1 1 170px;min-width:150px\" data-admin-filter=\"course-discipline\" aria-label=\"Filter by discipline\"><option value=\"\">All Disciplines (全部学科)</option>' + disciplines.map(d => '<option value=\"' + esc(d) + '\"' + (courseFilter.discipline === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select>' +\n      '<select style=\"flex:1 1 170px;min-width:150px\" data-admin-filter=\"course-group\" aria-label=\"Group courses\"><option value=\"\">No Grouping</option><option value=\"department\" selected>Group by Department (按学院分组)</option><option value=\"academicYear\">Group by Year (按学年分组)</option><option value=\"category\">Group by Subject (按学科分组)</option><option value=\"teacher\">Group by Instructor (按教师分组)</option></select></div>';\n    const rowHtml = c => '<tr><td><strong>' + (c.coverImage ? '<img src=\"' + esc(c.coverImage) + '\" alt=\"\" style=\"width:28px;height:28px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:6px\">' : '<span style=\"font-size:18px;vertical-align:middle;margin-right:6px\">' + esc(c.cover || '📘') + '</span>') + esc(c.title) + '</strong><br><span class=\"tiny muted\">' + [c.ownerDepartment ? '所属学院：' + esc(c.ownerDepartment) : '', c.courseType === 'normal' ? '普通课程' : '在线课程', c.academicYear ? esc(c.academicYear) : '', esc(c.category || 'General'), 'Code: <code>' + esc(c.enrollmentCode || '—') + '</code>'].filter(Boolean).join(' · ') + '</span></td>' +\n      '<td>' + esc(c.teacherName || 'Instructor') + '</td>' +\n      '<td>' + esc((c.departments || []).join(', ') || '—') + '</td>' +\n      '<td><span class=\"pill blue\">' + n(c.studentCount) + ' students</span></td>' +\n      '<td>' + n(c.lessonCount) + ' units · ' + (c.quizAvailable ? 'Quiz Ready' : 'No Quiz') + '</td>' +\n      '<td><div class=\"row wrap\"><button type=\"button\" class=\"btn btn-light btn-sm\" data-admin-action=\"view-course-students\" data-id=\"' + esc(c.id) + '\">Students (' + n(c.studentCount) + ')</button>' +\n      '<button type=\"button\" class=\"btn btn-primary btn-sm\" data-admin-action=\"manage-course\" data-id=\"' + esc(c.id) + '\">Manage Content →</button><button type=\"button\" class=\"btn btn-soft btn-sm\" data-admin-action=\"edit-course\" data-id=\"' + esc(c.id) + '\">Edit</button>' +\n      '<button type=\"button\" class=\"btn btn-light btn-sm\" data-admin-action=\"duplicate-course\" data-id=\"' + esc(c.id) + '\">Duplicate</button>' +\n      '<button type=\"button\" class=\"btn btn-danger btn-sm\" data-admin-action=\"delete-course\" data-id=\"' + esc(c.id) + '\">Delete</button></div></td></tr>';\n    const groupKey = courseFilter.groupBy || '';\n    const groupLabelOf = c => groupKey === 'academicYear' ? (c.academicYear || '未填写学年')\n      : groupKey === 'category' ? (c.category || '未分类')\n      : groupKey === 'teacher' ? (c.teacherName || '未分配教师')\n      : ((c.departments || [])[0] || (c.targetDepartments || [])[0] || '未分配学院');\n    const groups = groupKey\n      ? [...new Set(filteredCourses.map(groupLabelOf))].sort((a, b) => String(a).localeCompare(String(b))).map(label => ({ label, list: filteredCourses.filter(c => groupLabelOf(c) === label) }))\n      : [{ label: '', list: filteredCourses }];\n    const tableSections = groups.map(group => (group.label ? '<div class=\"panel-pad\" style=\"padding-top:14px;border-top:1px solid var(--border)\"><h3 style=\"margin:0 0 10px\">' + esc(group.label) + ' <span class=\"pill blue\">' + group.list.length + '</span></h3>' : '') +\n      '<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>Course</th><th>Instructor(s)</th><th>Department</th><th>Enrolled</th><th>Content</th><th>Actions</th></tr></thead><tbody>' +\n      (group.list.map(rowHtml).join('') || '<tr><td colspan=\"6\">No matching courses.</td></tr>') + '</tbody></table></div>' + (group.label ? '</div>' : '')).join('');\n    return subTabs + formHtml + '<section class=\"panel\"><div class=\"panel-pad\"><h2>Course Management <span class=\"pill blue\">' + filteredCourses.length + ' / ' + allCourses.length + '</span></h2>' +\n      '<p class=\"small muted\">Courses are grouped by department by default. Use the filters to manage a specific college or instructor.</p></div>' +\n      filterBar + tableSections + '</section>';\n  }\n  function backupPanel() {\n    return '<section class=\"panel panel-pad\" style=\"margin-bottom:20px\"><h2>Export Data Backup (导出数据备份)</h2>' +\n      '<p class=\"small muted\">Download a JSON backup of all schools, accounts, departments, announcements, courses, and grades before redeploying.</p>' +\n      '<a class=\"btn btn-primary\" href=\"/api/admin/backup/export\" download>⬇ Export Full Backup (.json)</a></section>' +\n      '<section class=\"panel panel-pad\"><h2>Merge & Restore Historical Data (合并恢复历史数据)</h2>' +\n      '<p class=\"small muted\">Upload a previously exported <code>.json</code> backup file. Existing records are preserved and historical records are safely merged without duplicates.</p>' +\n      '<form id=\"admin-backup-merge-form\" style=\"margin-top:12px\"><div class=\"row wrap\">' +\n      '<input id=\"admin-backup-file\" type=\"file\" accept=\".json,application/json\" required>' +\n      '<button type=\"submit\" class=\"btn btn-soft\">Merge Backup Data</button></div></form></section>';\n  }\n  function announcementsTable() {\n    const list = adminData?.announcements || [];\n    const editing = annEditItem;\n    const formHtml = '<section class=\"panel panel-pad\" style=\"margin-bottom:20px\"><h2>' + (editing ? 'Edit Announcement' : 'Publish Information Announcement') + '</h2>' +\n      '<p class=\"small muted\">Published announcements appear on the main dashboard for all instructors and students in your school.</p>' +\n      '<form id=\"admin-announcement-form\"' + (editing ? ' data-id=\"' + esc(editing.id) + '\"' : '') + '>' +\n      '<div class=\"form-grid\"><div class=\"field\"><label for=\"ann-category\">Category</label><select id=\"ann-category\" name=\"category\">' +\n      Object.entries(ANN_CATEGORIES).map(([k, label]) => '<option value=\"' + k + '\"' + (editing?.category === k ? ' selected' : '') + '>' + label + '</option>').join('') +\n      '</select></div><div class=\"field\"><label for=\"ann-title\">Title</label><input id=\"ann-title\" name=\"title\" value=\"' + esc(editing?.title || '') + '\" maxlength=\"120\" placeholder=\"Announcement title\" required></div></div>' +\n      '<div class=\"field\"><label for=\"ann-content\">Content</label><textarea id=\"ann-content\" name=\"content\" rows=\"4\" maxlength=\"5000\" placeholder=\"Write announcement details…\" required>' + esc(editing?.content || '') + '</textarea></div>' +\n      '<div class=\"row wrap\"><button type=\"submit\" class=\"btn btn-primary\">' + (editing ? 'Save Changes' : 'Publish Announcement') + '</button>' +\n      (editing ? '<button type=\"button\" class=\"btn btn-light\" data-admin-action=\"cancel-edit-ann\">Cancel</button>' : '') + '</div></form></section>';\n    const rows = list.length ? list.map(a => '<section class=\"panel panel-pad\" style=\"margin-bottom:14px\"><div class=\"row-between wrap\"><div>' +\n      '<span class=\"pill blue\">' + esc(ANN_CATEGORIES[a.category] || a.category) + '</span> ' +\n      '<strong style=\"font-size:16px;margin-left:6px\">' + esc(a.title) + '</strong>' +\n      '<div class=\"tiny muted\" style=\"margin-top:4px\">By ' + esc(a.authorName || 'Administrator') + ' · ' + fmtDate(a.updatedAt || a.createdAt) + '</div></div>' +\n      '<div class=\"row wrap\"><button type=\"button\" class=\"btn btn-soft btn-sm\" data-admin-action=\"edit-ann\" data-id=\"' + esc(a.id) + '\">Edit</button>' +\n      '<button type=\"button\" class=\"btn btn-danger btn-sm\" data-admin-action=\"delete-ann\" data-id=\"' + esc(a.id) + '\">Delete</button></div></div>' +\n      '<p style=\"margin:12px 0 0;white-space:pre-wrap\">' + esc(a.content) + '</p></section>').join('')\n      : em('No announcements yet', 'Publish school, college, or academic affairs announcements above.');\n    return formHtml + rows;\n  }\n  function instructorTable() {\n    const allTeachers = adminData?.teachers || [];\n    const pending = adminData?.pendingTeachers || [];\n    const depts = uniqueValues(allTeachers, 'department');\n    const majors = uniqueValues(allTeachers, 'major');\n    const teachers = allTeachers.filter(t => {\n      if (!matchesQuery(t, teacherFilter.q)) return false;\n      if (teacherFilter.department && (t.department || '') !== teacherFilter.department) return false;\n      if (teacherFilter.major && (t.major || '') !== teacherFilter.major) return false;\n      if (teacherFilter.status === 'active' && !t.active) return false;\n      if (teacherFilter.status === 'inactive' && t.active) return false;\n      if (teacherFilter.position && (t.position || '教师') !== teacherFilter.position) return false;\n      return true;\n    });\n    const pendingSection = pending.length\n      ? '<section class=\"panel\" style=\"margin-bottom:20px\"><div class=\"panel-pad\"><h2>Pending School Binding Requests <span class=\"pill blue\">' + pending.length + '</span></h2>' +\n        '<p class=\"small muted\">Review instructors who requested to bind their account to a school code.</p></div>' +\n        '<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>Instructor</th><th>Account ID</th><th>Requested School</th><th>Actions</th></tr></thead><tbody>' +\n        pending.map(t => '<tr><td><strong>' + esc(t.name) + '</strong><br><span class=\"muted\">' + esc(t.email) + '</span></td><td>' + esc(t.accountId || '—') +\n          '</td><td><strong>' + esc(t.pendingSchool?.name || '') + '</strong><br><span class=\"muted\">Code: ' + esc(t.pendingSchool?.code || '') + '</span></td>' +\n          '<td><div class=\"row wrap\"><button type=\"button\" class=\"btn btn-primary btn-sm\" data-admin-action=\"approve-teacher\" data-id=\"' + esc(t.id) + '\">Approve</button>' +\n          '<button type=\"button\" class=\"btn btn-danger btn-sm\" data-admin-action=\"reject-teacher\" data-id=\"' + esc(t.id) + '\">Reject</button></div></td></tr>').join('') +\n        '</tbody></table></div></section>'\n      : '';\n    const importSection = '<section class=\"panel panel-pad\" style=\"margin-bottom:20px\"><div class=\"row-between wrap\"><div><h2>Bulk Import Instructors</h2>' +\n      '<p class=\"small muted\">Download a CSV/TSV/JSON template or prepare an XLSX/CSV/TSV/JSON file; fill in instructor rows and import directly.</p></div>' +\n      '<a class=\"btn btn-light btn-sm\" href=\"/api/admin/import/template?role=teacher\" download=\"teacher-import-template.csv\">⬇ Download Teacher Template (.csv)</a></div>' +\n      '<form id=\"admin-import-teacher-form\" style=\"margin-top:12px\"><div class=\"row wrap\">' +\n      '<input id=\"admin-import-teacher-file\" type=\"file\" accept=\".csv,.xlsx,.tsv,.tab,.txt,.json,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\" required>' +\n      '<button type=\"submit\" class=\"btn btn-primary btn-sm\">Import Instructor Roster</button></div></form></section>';\n    const filterBar = '<div class=\"filter-line\" style=\"padding:0 20px 14px\"><div class=\"searchbar\"><span>⌕</span><input id=\"teacher-filter-q\" data-admin-filter=\"teacher-q\" type=\"search\" value=\"' + esc(teacherFilter.q) + '\" placeholder=\"Search name, account ID, email, department, major\"></div>' +\n      '<div class=\"row wrap\"><select data-admin-filter=\"teacher-department\" aria-label=\"Filter by department\"><option value=\"\">All Departments</option>' + depts.map(d => '<option value=\"' + esc(d) + '\"' + (teacherFilter.department === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select>' +\n      '<select data-admin-filter=\"teacher-major\" aria-label=\"Filter by major\"><option value=\"\">All Majors</option>' + majors.map(m => '<option value=\"' + esc(m) + '\"' + (teacherFilter.major === m ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select>' +\n      '<select data-admin-filter=\"teacher-position\" aria-label=\"按职位筛选\"><option value=\"\">所有职位 (All Positions)</option>' + TEACHER_POSITIONS.map(p => '<option value=\"' + p + '\"' + (teacherFilter.position === p ? ' selected' : '') + '>' + p + '</option>').join('') + '</select>' +\n      '<select data-admin-filter=\"teacher-status\" aria-label=\"Filter by status\"><option value=\"\">所有账号状态</option><option value=\"active\"' + (teacherFilter.status === 'active' ? ' selected' : '') + '>在职/正常</option><option value=\"inactive\"' + (teacherFilter.status === 'inactive' ? ' selected' : '') + '>已停用</option></select></div></div>';\n    const rows = teachers.map(t => '<tr><td><strong>' + esc(t.name) + '</strong>' + (t.gender ? ' <span class=\"tiny muted\">(' + esc(t.gender) + ')</span>' : '') + '<br><span class=\"muted\">' + esc(t.email) + '</span></td>' +\n      '<td>' + esc(t.accountId || '—') + '</td><td>' + esc(t.school?.name || 'Unassigned') + '</td>' +\n      '<td>' + esc([t.department, t.major].filter(Boolean).join(' · ') || '—') + '</td>' +\n      '<td><div style=\"display:flex;align-items:center;gap:6px;flex-wrap:wrap\">' +\n        '<select data-admin-teacher-pos=\"' + esc(t.id) + '\" aria-label=\"设置教师职位\" style=\"min-height:32px;padding:4px 8px;font-size:12px;font-weight:700;border-radius:8px;width:auto;' + (POSITION_BADGE_COLORS[t.position || '教师'] || '') + '\">' + positionOptionsHtml(t.position || '教师') + '</select>' +\n        (t.active ? '' : '<span class=\"pill gray\">已停用</span>') +\n      '</div></td><td>' + n(t.courseCount) + '</td><td>' +\n      (t.active ? '<div class=\"row wrap\"><button type=\"button\" class=\"btn btn-light btn-sm\" data-admin-action=\"assign-dept\" data-id=\"' + esc(t.id) + '\" data-role=\"teacher\">Assign Dept</button><button type=\"button\" class=\"btn btn-soft btn-sm\" data-admin-action=\"password\" data-id=\"' + esc(t.id) + '\" data-role=\"teacher\">Reset Password</button>' +\n      '<button type=\"button\" class=\"btn btn-danger btn-sm\" data-admin-action=\"remove-teacher\" data-id=\"' + esc(t.id) + '\">Deactivate</button></div>' : '<div class=\"row wrap\"><button type=\"button\" class=\"btn btn-soft btn-sm\" data-admin-action=\"restore-teacher\" data-id=\"' + esc(t.id) + '\">Restore</button><button type=\"button\" class=\"btn btn-danger btn-sm\" data-admin-action=\"delete-teacher-permanent\" data-id=\"' + esc(t.id) + '\">Delete</button></div>') + '</td></tr>').join('');\n    return pendingSection + departmentPanel() + importSection + '<section class=\"panel panel-pad\" style=\"margin-bottom:20px\"><h2>Add an Instructor</h2><p class=\"small muted\">Create a separate login for each instructor.</p>' +\n      '<form id=\"admin-add-teacher\"><div class=\"form-grid\"><div class=\"field\"><label for=\"admin-teacher-name\">姓名 (Name) *</label><input id=\"admin-teacher-name\" name=\"name\" required maxlength=\"60\" placeholder=\"例如：吴彦祖\"></div>' +\n      '<div class=\"field\"><label for=\"admin-teacher-email\">电子邮件 (Email) *</label><input id=\"admin-teacher-email\" name=\"email\" type=\"email\" placeholder=\"teacher@example.com\" required></div>' +\n      '<div class=\"field\"><label for=\"admin-teacher-position\">职务 / 职位 (Position)</label><select id=\"admin-teacher-position\" name=\"position\">' + positionOptionsHtml('教师') + '</select></div>' +\n      '<div class=\"field\"><label for=\"admin-teacher-dept\">所属院系 (Department)</label><input id=\"admin-teacher-dept\" name=\"department\" list=\"admin-add-teacher-dept-list\" maxlength=\"80\" placeholder=\"可选，如：计算机学院\"><datalist id=\"admin-add-teacher-dept-list\">' + (adminData?.departments || []).map(d => '<option value=\"' + esc(d.name) + '\">').join('') + '</datalist></div>' +\n      '<div class=\"field\"><label for=\"admin-teacher-grade\">登记年级 (Grade)</label><input id=\"admin-teacher-grade\" name=\"grade\" maxlength=\"40\" placeholder=\"如：三年级 / 初一 / 2026级\"></div>' +\n      '<div class=\"field\"><label for=\"admin-teacher-cross\">可跨年级 (Cross Grades)</label><input id=\"admin-teacher-cross\" name=\"crossGrades\" maxlength=\"300\" placeholder=\"多个年级用逗号分隔，如：四年级,五年级\"></div>' +\n      '<div class=\"field\"><label for=\"admin-teacher-password\">临时密码 (Temporary Password) *</label><input id=\"admin-teacher-password\" name=\"password\" type=\"password\" autocomplete=\"new-password\" minlength=\"8\" maxlength=\"128\" required placeholder=\"至少8位字符\"></div></div>' +\n      '<button type=\"submit\" class=\"btn btn-primary\">创建教师账户</button></form></section>' +\n      '<section class=\"panel\"><div class=\"panel-pad\"><h2>Instructor Accounts <span class=\"pill blue\">' + teachers.length + ' / ' + allTeachers.length + '</span></h2><p class=\"small muted\">Deactivate an account to prevent sign-in while retaining its courses and records.</p></div>' +\n      filterBar + '<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>Instructor</th><th>Account ID</th><th>School</th><th>Dept / Major</th><th>职位 (Position)</th><th>Courses</th><th>Actions</th></tr></thead><tbody>' +\n      (rows || '<tr><td colspan=\"7\">No matching instructor accounts.</td></tr>') + '</tbody></table></div></section>';\n  }\n\n  function studentTable() {\n    const allStudents = adminData?.students || [];\n    const courses = adminData?.courses || [];\n    const depts = uniqueValues(allStudents, 'department');\n    const majors = uniqueValues(allStudents, 'major');\n    const genders = uniqueValues(allStudents, 'gender');\n    const classes = adminData?.classes || [];\n    const classOptions = classes.filter(c => (!studentFilter.department || c.department === studentFilter.department) && (!studentFilter.major || c.major === studentFilter.major));\n    const students = allStudents.filter(s => {\n      if (!matchesQuery(s, studentFilter.q)) return false;\n      if (studentFilter.department && (s.department || '') !== studentFilter.department) return false;\n      if (studentFilter.major && (s.major || '') !== studentFilter.major) return false;\n      if (studentFilter.gender && (s.gender || '') !== studentFilter.gender) return false;\n      if (studentFilter.classId && !(s.classIds || []).includes(studentFilter.classId)) return false;\n      return true;\n    });\n    const importSection = '<section class=\"panel panel-pad\" style=\"margin-bottom:20px\"><div class=\"row-between wrap\"><div><h2>Bulk Import Students</h2>' +\n      '<p class=\"small muted\">CSV/XLSX/TSV/JSON 文件支持“院系、专业、班级”三列；导入时自动按 学院 › 专业 › 班级 建班并把学生分配进去。</p></div>' +\n      '<a class=\"btn btn-light btn-sm\" href=\"/api/admin/import/template?role=student\" download=\"student-import-template.csv\">⬇ Download Student Template (.csv)</a></div>' +\n      '<form id=\"admin-import-student-form\" style=\"margin-top:12px\"><div class=\"row wrap\">' +\n      '<input id=\"admin-import-student-file\" type=\"file\" accept=\".csv,.xlsx,.tsv,.tab,.txt,.json,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\" required>' +\n      '<button type=\"submit\" class=\"btn btn-primary btn-sm\">Import Student Roster</button></div></form></section>';\n    const filterBar = '<div class=\"filter-line\" style=\"margin-bottom:16px\"><div class=\"searchbar\"><span>⌕</span><input id=\"student-filter-q\" data-admin-filter=\"student-q\" type=\"search\" value=\"' + esc(studentFilter.q) + '\" placeholder=\"Search name, student ID, email, department, major\"></div>' +\n      '<div class=\"row wrap\"><select data-admin-filter=\"student-department\" aria-label=\"Filter by department\"><option value=\"\">All Departments</option>' + depts.map(d => '<option value=\"' + esc(d) + '\"' + (studentFilter.department === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select>' +\n      '<select data-admin-filter=\"student-major\" aria-label=\"Filter by major\"><option value=\"\">All Majors</option>' + majors.map(m => '<option value=\"' + esc(m) + '\"' + (studentFilter.major === m ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select>' +\n      '<select data-admin-filter=\"student-gender\" aria-label=\"Filter by gender\"><option value=\"\">All Genders</option>' + genders.map(g => '<option value=\"' + esc(g) + '\"' + (studentFilter.gender === g ? ' selected' : '') + '>' + esc(g) + '</option>').join('') + '</select>' +\n      '<select data-admin-filter=\"student-class\" aria-label=\"Filter by class\"><option value=\"\">所有班级</option>' + classOptions.map(c => '<option value=\"' + esc(c.id) + '\"' + (studentFilter.classId === c.id ? ' selected' : '') + '>' + esc(c.path || c.name) + '</option>').join('') + '</select></div></div>' +\n      '<datalist id=\"admin-class-options\">' + classes.map(c => '<option value=\"' + esc(c.name) + '\">' + esc(c.path || c.name) + '</option>').join('') + '</datalist>';\n    if (!allStudents.length) return departmentPanel() + importSection + em('No students yet', 'Students will appear here after registering or importing.');\n    const cards = students.length ? students.map(s => {\n      const enrolled = new Set((s.enrollments || []).map(e => e.courseId));\n      const list = (s.enrollments || []).map(e => '<div class=\"student-detail-row\"><span><strong>' + esc(e.courseTitle) + '</strong> · ' + esc(e.teacherName || 'Instructor') + '</span>' +\n        '<button class=\"btn btn-danger btn-sm\" type=\"button\" data-admin-action=\"remove-enrollment\" data-student-id=\"' + esc(s.id) + '\" data-course-id=\"' + esc(e.courseId) + '\">Remove</button></div>').join('');\n      const available = courses.filter(c => !enrolled.has(c.id));\n      const options = available.map(c => '<option value=\"' + esc(c.id) + '\">' + esc(c.title) + ' · ' + esc(c.teacherName || 'Instructor') + '</option>').join('');\n      const addForm = available.length ? '<form class=\"admin-enrollment-form\" data-student-id=\"' + esc(s.id) + '\"><div class=\"row wrap\"><select name=\"courseId\" aria-label=\"Course to add\" required>' + options +\n        '</select><button class=\"btn btn-soft btn-sm\" type=\"submit\">Add to Course</button></div></form>' : '<p class=\"small muted\">Enrolled in every available course.</p>';\n      const metaParts = [s.email, 'Student ID ' + (s.studentId || 'N/A'), s.gender, [s.department, s.major].filter(Boolean).join(' · '), s.classPath || s.className || '未分班', s.school?.name || 'Unassigned'].filter(Boolean);\n      return '<section class=\"panel panel-pad\" style=\"margin-bottom:16px\"><div class=\"row-between\"><div><h2 style=\"margin:0 0 5px\">' + esc(s.name) + '</h2><p class=\"small muted\" style=\"margin:0\">' +\n        esc(metaParts.join(' · ')) + '</p></div><div class=\"row wrap\"><button class=\"btn btn-light btn-sm\" type=\"button\" data-admin-action=\"assign-dept\" data-id=\"' + esc(s.id) +\n        '\" data-role=\"student\">Assign Dept</button><button class=\"btn btn-soft btn-sm\" type=\"button\" data-admin-action=\"password\" data-id=\"' + esc(s.id) +\n        '\" data-role=\"student\">Reset Password</button></div></div>' +\n        '<form class=\"admin-student-class-form\" data-student-id=\"' + esc(s.id) + '\" style=\"margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center\"><input name=\"className\" list=\"admin-class-options\" value=\"' + esc(s.className || '') + '\" placeholder=\"班级名称，如 软件1班\" style=\"max-width:240px\"><button type=\"submit\" class=\"btn btn-light btn-sm\">分配到班级</button>' +\n        ((s.classIds || []).length ? '<span class=\"tiny muted\">当前：' + esc(s.classPath || s.className) + '</span>' : '<span class=\"tiny muted\">尚未分班</span>') + '</form>' +\n        '<div class=\"student-detail\">' + (list || '<p class=\"small muted\">No enrolled courses.</p>') + '</div>' +\n        '<div style=\"margin-top:16px\"><strong class=\"small\">Adjust Course Enrollment</strong>' + addForm + '</div></section>';\n    }).join('') : em('No matching students', 'Try adjusting your search or filter criteria.');\n    return departmentPanel() + importSection + filterBar + cards;\n  }\n\n  function courseStudentsDialog() {\n    if (!courseStudentsModal) return '';\n    const c = courseStudentsModal;\n    const list = c.enrolledStudents || [];\n    const enrolledIds = new Set(list.map(s => s.id));\n    const available = (adminData?.students || []).filter(s => !enrolledIds.has(s.id));\n    const studentOptions = available.map(s => '<option value=\"' + esc(s.id) + '\">' + esc(s.name) + ' (' + esc(s.studentId || s.email || 'No ID') + ')' + (s.department ? ' · ' + esc(s.department) : '') + '</option>').join('');\n    const enrolledRows = list.length ? list.map(s => '<div class=\"student-detail-row\" style=\"align-items:center;gap:10px\">' +\n      '<label style=\"display:flex;align-items:center;gap:8px;flex:1;cursor:pointer\"><input type=\"checkbox\" name=\"removeStudentIds\" value=\"' + esc(s.id) + '\"><span><strong>' + esc(s.name) + '</strong> (' + esc(s.studentId || s.email || 'No ID') + ')</span></label>' +\n      '<span class=\"tiny muted\">' + esc([s.department, s.major].filter(Boolean).join(' · ') || 'No dept') + '</span>' +\n      '<button class=\"btn btn-danger btn-sm\" type=\"button\" data-admin-action=\"remove-enrollment\" data-student-id=\"' + esc(s.id) + '\" data-course-id=\"' + esc(c.id) + '\">Remove</button></div>').join('') : '<p class=\"small muted\">No students enrolled in this course yet.</p>';\n    const addForm = available.length\n      ? '<form id=\"admin-course-add-students-form\" data-course-id=\"' + esc(c.id) + '\" style=\"margin-top:16px\"><div class=\"field\"><label>Add students (hold Cmd/Ctrl to select multiple)</label><select name=\"studentIds\" multiple size=\"6\" style=\"width:100%;min-height:140px\">' + studentOptions + '</select></div><div class=\"row wrap\" style=\"margin-top:10px\"><button type=\"submit\" class=\"btn btn-primary btn-sm\">Add selected students</button><span class=\"small muted\">' + available.length + ' student(s) available</span></div></form>'\n      : '<p class=\"small muted\" style=\"margin-top:16px\">All students are already enrolled in this course.</p>';\n    const classOptions = (adminData?.classes || []).filter(cls => available.some(s => (cls.studentIds || []).includes(s.id)))\n      .map(cls => '<option value=\"' + esc(cls.id) + '\">' + esc(cls.path || [cls.department, cls.major, cls.name].filter(Boolean).join(' › ')) + ' (' + n(cls.studentCount) + ' students)</option>').join('');\n    const classAddForm = classOptions\n      ? '<form id=\"admin-course-add-class-form\" data-course-id=\"' + esc(c.id) + '\" style=\"margin-top:14px\"><div class=\"field\"><label>Add by class（按班级整班加入）</label><select name=\"classIds\" multiple size=\"4\" style=\"width:100%;min-height:90px\">' + classOptions + '</select></div><div class=\"row wrap\" style=\"margin-top:8px\"><button type=\"submit\" class=\"btn btn-soft btn-sm\">Add selected classes</button><span class=\"small muted\">Only classes with unenrolled students are shown.</span></div></form>'\n      : '';\n    const removeForm = list.length\n      ? '<form id=\"admin-course-remove-students-form\" data-course-id=\"' + esc(c.id) + '\" style=\"margin-top:18px\"><div class=\"row-between\"><strong class=\"small\">Remove students</strong><button type=\"submit\" class=\"btn btn-danger btn-sm\">Remove selected</button></div><div style=\"max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:8px;margin-top:8px\">' + enrolledRows + '</div></form>'\n      : '';\n    return '<div class=\"modal-backdrop\" data-admin-action=\"close-course-students\"><div class=\"modal\" style=\"max-width:760px\"><div class=\"modal-head\"><h2>' + esc(c.title) + ' · Enrolled Students (' + list.length + ')</h2>' +\n      '<button class=\"icon-btn\" type=\"button\" data-admin-action=\"close-course-students\" aria-label=\"Close\">✕</button></div><div class=\"modal-body\">' +\n      '<p class=\"small muted\">Instructor(s): <strong>' + esc(c.teacherName) + '</strong> · Enrollment Code: <code>' + esc(c.enrollmentCode || '—') + '</code></p>' +\n      addForm + classAddForm + removeForm +\n      '</div><div class=\"modal-actions\"><button class=\"btn btn-light\" type=\"button\" data-admin-action=\"close-course-students\">Close</button></div></div></div>';\n  }\n  function classModal() {\n    if (!classEditItem) return '';\n    const selected = new Set(classEditItem.studentIds || []);\n    const options = (adminData?.students || []).map(s => '<option value=\"' + esc(s.id) + '\"' + (selected.has(s.id) ? ' selected' : '') + '>' + esc(s.name) + ' (' + esc(s.studentId || s.email || 'No ID') + ')' + (s.department ? ' · ' + esc(s.department) : '') + (s.grade ? ' · ' + esc(s.grade) : '') + '</option>').join('');\n    return '<div class=\"modal-backdrop\" data-admin-action=\"close-class-modal\"><div class=\"modal\" style=\"max-width:720px\"><div class=\"modal-head\"><h2>Edit Class / 管理班级学生</h2>' +\n      '<button class=\"icon-btn\" type=\"button\" data-admin-action=\"close-class-modal\" aria-label=\"Close\">✕</button></div>' +\n      '<form id=\"admin-class-form\" data-id=\"' + esc(classEditItem.id) + '\"><div class=\"modal-body\"><div class=\"form-grid\">' +\n      '<div class=\"field\"><label>Class Name *</label><input name=\"name\" value=\"' + esc(classEditItem.name || '') + '\" maxlength=\"80\" required></div>' +\n      '<div class=\"field\"><label>Grade</label><input name=\"grade\" value=\"' + esc(classEditItem.grade || '') + '\" maxlength=\"40\"></div>' +\n      '<div class=\"field\"><label>Department</label><input name=\"department\" value=\"' + esc(classEditItem.department || '') + '\" maxlength=\"80\"></div>' +\n      '<div class=\"field\"><label>Academic Year</label><input name=\"academicYear\" value=\"' + esc(classEditItem.academicYear || '') + '\" maxlength=\"40\"></div></div>' +\n      '<div class=\"field\"><label>Class Students（hold Cmd/Ctrl to select multiple）</label><select name=\"studentIds\" multiple size=\"10\" style=\"width:100%;min-height:190px\">' + options + '</select></div></div>' +\n      '<div class=\"modal-actions\"><button class=\"btn btn-light\" type=\"button\" data-admin-action=\"close-class-modal\">Cancel</button><button class=\"btn btn-primary\" type=\"submit\">Save Class</button></div></form></div></div>';\n  }\n  function deptDialog() {\n    if (!deptDialogUser) return '';\n    const depts = (adminData?.departments || []).map(d => d.name);\n    return '<div class=\"modal-backdrop\" data-admin-action=\"close-dept-dialog\"><div class=\"modal\"><div class=\"modal-head\"><h2>Assign Department & Major</h2>' +\n      '<button class=\"icon-btn\" type=\"button\" data-admin-action=\"close-dept-dialog\" aria-label=\"Close\">✕</button></div>' +\n      '<form id=\"admin-dept-form\" data-id=\"' + esc(deptDialogUser.id) + '\"><div class=\"modal-body\">' +\n      '<p class=\"small muted\">Update department and major for <strong>' + esc(deptDialogUser.name) + '</strong>.</p>' +\n      '<div class=\"field\"><label for=\"admin-user-dept\">Department (院系)</label><input id=\"admin-user-dept\" name=\"department\" list=\"admin-dept-datalist\" value=\"' + esc(deptDialogUser.department || '') + '\" maxlength=\"80\" placeholder=\"Select or type a department\">' +\n      '<datalist id=\"admin-dept-datalist\">' + depts.map(d => '<option value=\"' + esc(d) + '\">').join('') + '</datalist></div>' +\n      '<div class=\"field\"><label for=\"admin-user-major\">Major (专业)</label><input id=\"admin-user-major\" name=\"major\" value=\"' + esc(deptDialogUser.major || '') + '\" maxlength=\"80\" placeholder=\"Enter major (optional)\"></div>' +\n      '</div><div class=\"modal-actions\"><button class=\"btn btn-light\" type=\"button\" data-admin-action=\"close-dept-dialog\">Cancel</button>' +\n      '<button class=\"btn btn-primary\" type=\"submit\">Save Assignment</button></div></form></div></div>';\n  }\n  function passwordDialog() {\n    if (!adminDialog) return '';\n    return '<div class=\"modal-backdrop\" data-admin-action=\"close-dialog\"><div class=\"modal\"><div class=\"modal-head\"><h2>Reset ' + esc(adminDialog.role) +\n      ' Password</h2><button class=\"icon-btn\" type=\"button\" data-admin-action=\"close-dialog\" aria-label=\"Close\">✕</button></div><form id=\"admin-password-form\" data-id=\"' +\n      esc(adminDialog.id) + '\"><div class=\"modal-body\"><p class=\"small muted\">Set a new password for ' + esc(adminDialog.name) + '.</p><div class=\"field\"><label for=\"admin-new-password\">New Password</label>' +\n      '<input id=\"admin-new-password\" name=\"password\" type=\"password\" autocomplete=\"new-password\" minlength=\"8\" maxlength=\"128\" required></div><div class=\"field\"><label for=\"admin-confirm-password\">Confirm Password</label>' +\n      '<input id=\"admin-confirm-password\" name=\"confirm\" type=\"password\" autocomplete=\"new-password\" minlength=\"8\" maxlength=\"128\" required></div></div><div class=\"modal-actions\">' +\n      '<button class=\"btn btn-light\" type=\"button\" data-admin-action=\"close-dialog\">Cancel</button><button class=\"btn btn-primary\" type=\"submit\">Save Password</button></div></form></div></div>';\n  }\n\n  function adminShell(customBody = null) {\n    const s = adminData?.stats || {};\n    const organization = adminData?.organization;\n    const scopeLabel = organization ? 'ORGANIZATION ADMINISTRATION' : 'SITE ADMINISTRATION';\n    const organizationPanel = organization\n      ? '<section class=\"panel panel-pad\" style=\"margin-bottom:20px\"><div class=\"row-between wrap\"><div><div class=\"eyebrow\">SCHOOL ORGANIZATION</div><h2 style=\"margin:5px 0\">' + esc(organization.name) + '</h2><p class=\"small muted\" style=\"margin:0\">学段：<strong>' + esc(SCHOOL_STAGE_LABELS[organization.stage] || '大学') + '</strong> · Students and instructors can join with the exact school name or code.</p></div><div><div class=\"tiny muted\">SCHOOL CODE</div><strong style=\"font-size:20px\">' + esc(organization.code) + '</strong></div></div></section>'\n      : '';\n    const body = customBody != null ? customBody : adminError\n      ? '<section class=\"panel panel-pad\"><p class=\"form-error\">' + esc(adminError) + '</p><button class=\"btn btn-soft\" data-admin-action=\"reload\">Retry</button></section>'\n      : !adminData ? '<section class=\"panel panel-pad\">Loading administrator records…</section>'\n      : '<div class=\"page-head\"><div><div class=\"eyebrow\">' + scopeLabel + '</div><h1>' + (adminTab === 'teachers' ? 'Instructor Accounts' : adminTab === 'students' ? 'Student Accounts' : adminTab === 'classes' ? 'Class Management' : adminTab === 'courses' ? 'Course Management' : adminTab === 'schedule' ? 'Smart Scheduling (智能排课)' : adminTab === 'announcements' ? 'Information Announcements' : 'Data Backup & Merge') +\n        '</h1><p>Manage user access and student course enrollment.</p></div></div>' + organizationPanel + '<div class=\"stats-grid\" style=\"margin-bottom:24px\">' +\n        stat('Instructors', n(s.teachers), 'Registered instructor accounts', '♧') + stat('Students', n(s.students), 'Registered student accounts', '▣') +\n        stat('Courses', n(s.courses), 'Courses across instructors', '▤') + stat('Announcements', n(s.announcements), 'Published school notices', '◈') + '</div>' + (adminTab === 'teachers' ? instructorTable() : adminTab === 'students' ? studentTable() : adminTab === 'classes' ? classesTable() : adminTab === 'courses' ? coursesTable() : adminTab === 'schedule' ? (typeof renderAdminScheduleWorkspace === 'function' ? renderAdminScheduleWorkspace() : '') : adminTab === 'announcements' ? announcementsTable() : backupPanel());\n    return '<div class=\"mobile-overlay ' + (state.mobileOpen ? 'show' : '') + '\" data-admin-action=\"close-menu\"></div><div class=\"app-shell\"><aside class=\"sidebar ' +\n      (state.mobileOpen ? 'open' : '') + '\">' + brand() + '<div class=\"sidebar-label\">' + scopeLabel + '</div><nav class=\"nav-list\" aria-label=\"Administrator Menu\">' +\n      '<button type=\"button\" class=\"nav-btn ' + (adminTab === 'teachers' ? 'active' : '') + '\" data-admin-action=\"tab\" data-tab=\"teachers\"><span class=\"ico\">♧</span>Instructors' + ((adminData?.pendingTeachers?.length || 0) ? '<span class=\"nav-count\">' + adminData.pendingTeachers.length + '</span>' : '') + '</button>' +\n      '<button type=\"button\" class=\"nav-btn ' + (adminTab === 'students' ? 'active' : '') + '\" data-admin-action=\"tab\" data-tab=\"students\"><span class=\"ico\">▣</span>Students</button>' +\n      '<button type=\"button\" class=\"nav-btn ' + (adminTab === 'courses' ? 'active' : '') + '\" data-admin-action=\"tab\" data-tab=\"courses\"><span class=\"ico\">▤</span>Courses</button>' +\n      '<button type=\"button\" class=\"nav-btn ' + (adminTab === 'schedule' ? 'active' : '') + '\" data-admin-action=\"tab\" data-tab=\"schedule\"><span class=\"ico\">◷</span>Smart Schedule</button>' +\n      '<button type=\"button\" class=\"nav-btn ' + (adminTab === 'announcements' ? 'active' : '') + '\" data-admin-action=\"tab\" data-tab=\"announcements\"><span class=\"ico\">◈</span>Announcements</button>' +\n      '<button type=\"button\" class=\"nav-btn ' + (adminTab === 'backup' ? 'active' : '') + '\" data-admin-action=\"tab\" data-tab=\"backup\"><span class=\"ico\">⇩</span>Backup & Merge</button></nav>' +\n      '<div class=\"sidebar-bottom\"><div class=\"side-user\"><span class=\"avatar sm\">' + initials(state.user?.name) + '</span><span class=\"side-user-text\"><strong>' + esc(state.user?.name) +\n      '</strong><small>' + (organization ? 'School Administrator' : 'Site Administrator') + '</small></span><button class=\"icon-btn\" type=\"button\" data-admin-action=\"logout\" aria-label=\"Sign Out\" title=\"Sign Out\">↪</button></div></div></aside>' +\n      '<div class=\"main-area\"><header class=\"topbar\"><div class=\"row\"><button class=\"mobile-menu\" type=\"button\" data-admin-action=\"toggle-menu\" aria-label=\"Open Menu\">☰</button>' +\n      '<div class=\"breadcrumbs\">Zhixing Learning / <b>Administration</b></div></div><span class=\"role-chip\">' + (organization ? 'School Administrator' : 'Site Administrator') + '</span></header><main class=\"content\">' + body +\n      '<footer class=\"site-footer\">Zhixing Learning · Site Administration</footer></main></div></div>' + passwordDialog() + deptDialog() + courseStudentsDialog() + classModal();\n  }\n\n  render = function() {\n    if (state.authMode === 'reset' && resetToken) {\n      app.innerHTML = authRecoveryPage();\n      return;\n    }\n    if (state.user?.role === 'admin') {\n      startAdminLoad();\n      if (state.page === 'detail' && state.selectedCourse) {\n        const backBtn = '<div style=\"margin-bottom:12px\"><button type=\"button\" class=\"btn-text\" data-admin-action=\"back-to-courses\">← Back to Admin Course Management</button></div>';\n        app.innerHTML = adminShell(backBtn + detailPage()) + modal();\n        return;\n      }\n      app.innerHTML = adminShell();\n      return;\n    }\n    if (!state.user && state.authMode === 'forgot') {\n      app.innerHTML = authRecoveryPage();\n      return;\n    }\n    if (!state.user) adminData = null;\n    originalRender();\n  };\n\n  document.addEventListener('click', event => {\n    const button = event.target.closest('[data-admin-action]');\n    if (!button) return;\n    const action = button.dataset.adminAction;\n    if ((action === 'close-dialog' || action === 'close-dept-dialog' || action === 'close-course-students' || action === 'close-class-modal') && button.classList.contains('modal-backdrop') && event.target !== button) return;\n    event.preventDefault();\n    if (action === 'forgot') {\n      state.authMode = 'forgot'; state.authError = ''; resetNotice = ''; render(); return;\n    }\n    if (action === 'back-to-login') {\n      resetToken = ''; resetNotice = ''; state.authMode = 'login'; state.authError = ''; render(); return;\n    }\n    if (action === 'course-subtab') { courseSubTab = button.dataset.tab; render(); return; }\n    if (action === 'tab') { adminTab = button.dataset.tab; state.page = 'admin'; state.selectedCourse = null; state.mobileOpen = false; render(); return; }\n    if (action === 'back-to-courses') { adminTab = 'courses'; state.page = 'admin'; state.selectedCourse = null; render(); return; }\n    if (action === 'manage-course') {\n      run(async () => { await loadCourse(button.dataset.id); }, 'Could not open course: ');\n      return;\n    }\n    if (action === 'toggle-menu') { state.mobileOpen = !state.mobileOpen; render(); return; }\n    if (action === 'close-menu') { state.mobileOpen = false; render(); return; }\n    if (action === 'close-dialog') { adminDialog = null; render(); return; }\n    if (action === 'close-dept-dialog') { deptDialogUser = null; render(); return; }\n    if (action === 'close-course-students') { courseStudentsModal = null; render(); return; }\n    if (action === 'view-course-students') {\n      courseStudentsModal = (adminData?.courses || []).find(c => c.id === button.dataset.id) || null;\n      render();\n      return;\n    }\n    if (action === 'duplicate-course') {\n      const course = (adminData?.courses || []).find(c => c.id === button.dataset.id);\n      if (!course || !confirm('Duplicate course \"' + course.title + '\"? Lessons, quizzes and assignments will be copied; student enrollments will not.')) return;\n      run(async () => {\n        await api('/api/admin/courses/' + encodeURIComponent(course.id) + '/duplicate', { method: 'POST' });\n        adminData = await api('/api/admin/overview');\n        render();\n        showToast('Course duplicated');\n      }, 'Could not duplicate course: ');\n      return;\n    }\n    if (action === 'edit-course') {\n      courseEditItem = (adminData?.courses || []).find(c => c.id === button.dataset.id) || null;\n      render();\n      return;\n    }\n    if (action === 'cancel-edit-course') { courseEditItem = null; render(); return; }\n    if (action === 'delete-course') {\n      if (!confirm('Delete this course and all its enrollments/quizzes/assignments?')) return;\n      run(async () => { await api('/api/admin/courses/' + encodeURIComponent(button.dataset.id), { method: 'DELETE' }); if (courseEditItem?.id === button.dataset.id) courseEditItem = null; adminData = await api('/api/admin/overview'); render(); showToast('Course deleted'); }, 'Could not delete course: ');\n      return;\n    }\n    if (action === 'close-class-modal') { classEditItem = null; render(); return; }\n    if (action === 'edit-class') {\n      classEditItem = (adminData?.classes || []).find(c => c.id === button.dataset.id) || null;\n      render();\n      return;\n    }\n    if (action === 'delete-class') {\n      const cls = (adminData?.classes || []).find(c => c.id === button.dataset.id);\n      if (!cls || !confirm('Delete class \"' + cls.name + '\"? Students and course enrollments will not be deleted.')) return;\n      run(async () => {\n        await api('/api/admin/classes/' + encodeURIComponent(cls.id), { method: 'DELETE' });\n        if (classEditItem?.id === cls.id) classEditItem = null;\n        adminData = await api('/api/admin/overview');\n        render();\n        showToast('Class deleted');\n      }, 'Could not delete class: ');\n      return;\n    }\n    if (action === 'assign-dept') {\n      const source = (button.dataset.role === 'teacher' ? adminData?.teachers : adminData?.students) || [];\n      const person = source.find(item => item.id === button.dataset.id);\n      if (person) { deptDialogUser = person; render(); }\n      return;\n    }\n    if (action === 'delete-dept') {\n      if (!confirm('Remove this department from the list?')) return;\n      run(async () => { await api('/api/admin/departments/' + encodeURIComponent(button.dataset.id), {method:'DELETE'}); adminData = await api('/api/admin/overview'); render(); showToast('Department removed'); }, 'Could not remove department: ');\n      return;\n    }\n    if (action === 'edit-ann') {\n      annEditItem = (adminData?.announcements || []).find(a => a.id === button.dataset.id) || null;\n      render();\n      return;\n    }\n    if (action === 'cancel-edit-ann') { annEditItem = null; render(); return; }\n    if (action === 'delete-ann') {\n      if (!confirm('Delete this announcement?')) return;\n      run(async () => { await api('/api/admin/announcements/' + encodeURIComponent(button.dataset.id), {method:'DELETE'}); if (annEditItem?.id === button.dataset.id) annEditItem = null; adminData = await api('/api/admin/overview'); render(); showToast('Announcement deleted'); }, 'Could not delete announcement: ');\n      return;\n    }\n    if (action === 'reload') { adminError = ''; adminData = null; render(); return; }\n    if (action === 'logout') {\n      run(async () => { await api('/api/auth/logout', {method:'POST'}); state.user = null; state.authRole = 'student'; state.authMode = 'login'; adminData = null; adminDialog = null; render(); showToast('You have signed out'); });\n      return;\n    }\n    if (action === 'password') {\n      const source = (button.dataset.role === 'teacher' ? adminData?.teachers : adminData?.students) || [];\n      const person = source.find(item => item.id === button.dataset.id);\n      if (person) { adminDialog = {id:person.id,name:person.name,role:button.dataset.role}; render(); }\n      return;\n    }\n    if (action === 'approve-teacher' || action === 'reject-teacher') {\n      const verb = action === 'approve-teacher' ? 'approve' : 'reject';\n      run(async () => {\n        await api('/api/admin/teacher-requests/' + encodeURIComponent(button.dataset.id) + '/' + verb, {method:'POST'});\n        adminData = await api('/api/admin/overview');\n        render();\n        showToast(verb === 'approve' ? 'Instructor approved and linked to school' : 'Request declined');\n      }, 'Could not update request: ');\n      return;\n    }\n    if (action === 'restore-teacher') {\n      run(async () => { await api('/api/admin/teachers/' + encodeURIComponent(button.dataset.id) + '/restore', { method: 'POST' }); adminData = await api('/api/admin/overview'); render(); showToast('Instructor account restored'); }, 'Could not restore instructor: ');\n      return;\n    }\n    if (action === 'delete-teacher-permanent') {\n      const teacher = (adminData?.teachers || []).find(t => t.id === button.dataset.id);\n      if (!teacher || !confirm('Permanently delete ' + teacher.name + '? This will remove the account and release its account ID/email.')) return;\n      run(async () => { await api('/api/admin/teachers/' + encodeURIComponent(teacher.id) + '/permanent', { method: 'DELETE' }); adminData = await api('/api/admin/overview'); render(); showToast('Instructor account permanently deleted'); }, 'Could not delete instructor: ');\n      return;\n    }\n    if (action === 'remove-teacher') {\n      const teacher = (adminData?.teachers || []).find(t => t.id === button.dataset.id);\n      if (!teacher || !confirm('Deactivate ' + teacher.name + '? They will no longer be able to sign in. Their courses and student records will be kept.')) return;\n      run(async () => { await api('/api/admin/teachers/' + encodeURIComponent(teacher.id), {method:'DELETE'}); adminData = await api('/api/admin/overview'); render(); showToast('Instructor account deactivated'); }, 'Could not deactivate instructor: ');\n      return;\n    }\n    if (action === 'remove-enrollment') {\n      const student = (adminData?.students || []).find(s => s.id === button.dataset.studentId);\n      const enrollment = student?.enrollments?.find(e => e.courseId === button.dataset.courseId);\n      if (!student || !enrollment || !confirm('Remove ' + student.name + ' from ' + enrollment.courseTitle + '?')) return;\n      run(async () => { await api('/api/admin/students/' + encodeURIComponent(student.id) + '/enrollments/' + encodeURIComponent(enrollment.courseId), {method:'DELETE'}); adminData = await api('/api/admin/overview'); if (courseStudentsModal) courseStudentsModal = (adminData?.courses || []).find(c => c.id === courseStudentsModal.id) || null; render(); showToast('Student removed from course'); }, 'Could not update enrollment: ');\n    }\n  });\n\n  // Handle administrator sign-in and school creation before the shared auth form listener.\n  document.addEventListener('submit', event => {\n    if (event.target.id !== 'auth-form' || state.authMode !== 'register' || state.authRole !== 'admin') return;\n    event.preventDefault(); event.stopImmediatePropagation();\n    const values = Object.fromEntries(new FormData(event.target));\n    run(async () => {\n      try {\n        const registering = state.authMode === 'register';\n        const result = registering\n          ? await api('/api/auth/register-admin', {method:'POST',body:JSON.stringify(values)})\n          : await api('/api/auth/login', {method:'POST',body:JSON.stringify({email:values.email,password:values.password})});\n        if (result.user?.role !== 'admin') {\n          await api('/api/auth/logout', {method:'POST'});\n          throw new Error('This account is not a site administrator.');\n        }\n        state.user = result.user; state.authError = ''; adminData = null; adminError = ''; state.page = 'admin'; render();\n        showToast((registering ? 'Organization created. Welcome, ' : 'Welcome back, ') + state.user.name + '!');\n      } catch (error) { state.authError = error.message; render(); }\n    });\n  }, true);\n\n  document.addEventListener('submit', event => {\n    const form = event.target;\n    if (!['admin-reset-request','admin-reset-confirm','admin-add-teacher','admin-password-form','admin-import-student-form','admin-import-teacher-form','admin-add-dept-form','admin-dept-form','admin-announcement-form','admin-backup-merge-form','admin-course-form','admin-course-add-students-form','admin-course-remove-students-form','admin-add-class-form','admin-class-form','admin-course-add-class-form','admin-student-class-form'].includes(form.id) && !form.classList.contains('admin-enrollment-form')) return;\n    event.preventDefault();\n    const values = Object.fromEntries(new FormData(form));\n    if (form.id === 'admin-student-class-form') {\n      const student = (adminData?.students || []).find(x => x.id === form.dataset.studentId) || {};\n      run(async () => {\n        const res = await api('/api/admin/classes/assign', { method: 'POST', body: JSON.stringify({\n          studentIds: [form.dataset.studentId], className: values.className,\n          department: student.department || '', major: student.major || '', grade: student.grade || ''\n        }) });\n        adminData = await api('/api/admin/overview'); render();\n        showToast('已分配到 ' + (res.classInfo?.path || values.className));\n      }, '分配失败: ');\n      return;\n    }\n    if (form.id === 'admin-reset-request') {\n      run(async () => {\n        try {\n          const result = await api('/api/auth/forgot-password', {method:'POST',body:JSON.stringify({email:values.email})});\n          resetNotice = result.message || 'If an account uses this email address, a reset link will be sent.';\n        } catch (error) { resetNotice = error.message; }\n        render();\n      });\n      return;\n    }\n    if (form.id === 'admin-reset-confirm') {\n      if (values.password !== values.confirm) { showToast('Passwords do not match', true); return; }\n      run(async () => {\n        await api('/api/auth/reset-password', {method:'POST',body:JSON.stringify({token:resetToken,password:values.password})});\n        resetToken = ''; resetNotice = ''; state.user = null; state.authMode = 'login'; state.authRole = 'student'; render();\n        showToast('Password updated. You can sign in now.');\n      }, 'Could not reset password: ');\n      return;\n    }\n    if (state.user?.role !== 'admin') return;\n    if (form.id === 'admin-import-student-form' || form.id === 'admin-import-teacher-form') {\n      const role = form.id === 'admin-import-student-form' ? 'student' : 'teacher';\n      const fileInput = form.querySelector('input[type=\"file\"]');\n      const file = fileInput?.files?.[0];\n      if (!file) { showToast('Please choose a CSV/XLSX/TSV/JSON file first', true); return; }\n      run(async () => {\n        const fileName = file.name || '';\n        const lowerName = fileName.toLowerCase();\n        if (lowerName.endsWith('.xls')) {\n          showToast('Old .xls format is not supported. Please save it as .xlsx, .csv, .tsv, or .json first.', true);\n          return;\n        }\n        const isXlsx = lowerName.endsWith('.xlsx') || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';\n        const payload = { role, fileName, contentType: file.type || '' };\n        if (isXlsx) {\n          const bytes = new Uint8Array(await file.arrayBuffer());\n          let binary = '';\n          const chunkSize = 0x8000;\n          for (let i = 0; i < bytes.length; i += chunkSize) {\n            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));\n          }\n          payload.contentBase64 = btoa(binary);\n        } else {\n          payload.csv = await file.text();\n        }\n        const result = await api('/api/admin/import', { method: 'POST', body: JSON.stringify(payload) });\n        adminData = await api('/api/admin/overview');\n        render();\n        showToast('Imported ' + n(result.importedCount) + ' ' + role + ' account(s)');\n      }, 'Import failed: ');\n      return;\n    }\n    if (form.id === 'admin-backup-merge-form') {\n      const file = form.querySelector('input[type=\"file\"]')?.files?.[0];\n      if (!file) { showToast('Please choose a JSON backup file first', true); return; }\n      run(async () => {\n        const text = await file.text();\n        let parsed;\n        try { parsed = JSON.parse(text); } catch { throw new Error('Invalid JSON backup file'); }\n        const res = await api('/api/admin/backup/merge', { method: 'POST', body: JSON.stringify({ backup: parsed }) });\n        adminData = await api('/api/admin/overview');\n        render();\n        const m = res.merged || {};\n        showToast('Merged: ' + n(m.users) + ' account(s), ' + n(m.courses) + ' course(s), ' + n(m.announcements) + ' announcement(s)');\n      }, 'Merge failed: ');\n      return;\n    }\n    if (form.id === 'admin-course-form') {\n      const teacherIds = [...form.querySelectorAll('input[name=\"teacherIds\"]:checked')].map(el => el.value);\n      if (!teacherIds.length) { showToast('Select at least one instructor', true); return; }\n      const editId = form.dataset.id;\n      const targetDepartments = [...form.querySelectorAll('input[name=\"targetDepartments\"]:checked')].map(el => el.value);\n      const targetMajors = String(values.targetMajorsText || '').split(/[,，;；]/).map(x => x.trim()).filter(Boolean);\n      const targetClassIds = [...form.querySelectorAll('input[name=\"targetClassIds\"]:checked')].map(el => el.value);\n      const payload = {\n        title: values.title, category: values.category, description: values.description,\n        academicYear: values.academicYear || '', ownerDepartment: values.ownerDepartment || '', courseType: values.courseType || 'online',\n        cover: values.cover || '📘', color: values.color || '#6979dc', targetDepartments, targetMajors,\n        autoEnroll: Boolean(form.querySelector('input[name=\"autoEnroll\"]')?.checked),\n        targetClassIds, teacherIds, ...(values.enrollmentCode?.trim() ? { enrollmentCode: values.enrollmentCode.trim() } : {})\n      };\n      run(async () => {\n        const coverFile = form.querySelector('#admin-course-cover-file')?.files?.[0];\n        if (coverFile) {\n          if (coverFile.size > 3 * 1024 * 1024) throw new Error('Cover image must be smaller than 3 MB');\n          const dataUrl = await new Promise((resolve, reject) => {\n            const reader = new FileReader();\n            reader.onload = () => resolve(String(reader.result));\n            reader.onerror = reject;\n            reader.readAsDataURL(coverFile);\n          });\n          payload.coverImage = dataUrl;\n        }\n        const res = editId\n          ? await api('/api/admin/courses/' + encodeURIComponent(editId), { method: 'PATCH', body: JSON.stringify(payload) })\n          : await api('/api/admin/courses', { method: 'POST', body: JSON.stringify(payload) });\n        courseEditItem = null;\n        adminData = await api('/api/admin/overview');\n        render();\n        showToast((editId ? 'Course updated' : 'Course created') + (res.autoEnrolledCount ? ' · ' + res.autoEnrolledCount + ' student(s) auto-enrolled' : '') + (res.classEnrolledCount ? ' · ' + res.classEnrolledCount + ' student(s) added by class' : ''));\n      }, 'Could not save course: ');\n      return;\n    }\n    if (form.id === 'admin-add-class-form' || form.id === 'admin-class-form') {\n      const studentIds = new FormData(form).getAll('studentIds').map(String);\n      const payload = { name: values.name, grade: values.grade || '', department: values.department || '', academicYear: values.academicYear || '', studentIds };\n      const isEdit = form.id === 'admin-class-form';\n      run(async () => {\n        if (isEdit) await api('/api/admin/classes/' + encodeURIComponent(form.dataset.id), { method: 'PATCH', body: JSON.stringify(payload) });\n        else await api('/api/admin/classes', { method: 'POST', body: JSON.stringify(payload) });\n        classEditItem = null;\n        adminData = await api('/api/admin/overview');\n        render();\n        showToast(isEdit ? 'Class updated' : 'Class created');\n      }, 'Could not save class: ');\n      return;\n    }\n    if (form.id === 'admin-course-add-class-form') {\n      const courseId = form.dataset.courseId;\n      const classIds = new FormData(form).getAll('classIds').map(String);\n      if (!classIds.length) { showToast('Please select at least one class', true); return; }\n      const course = (adminData?.courses || []).find(c => c.id === courseId);\n      if (!course) return;\n      if (!confirm('Add all students from ' + classIds.length + ' class(es) to ' + course.title + '?')) return;\n      run(async () => {\n        const res = await api('/api/admin/courses/' + encodeURIComponent(courseId) + '/enroll-classes', { method: 'POST', body: JSON.stringify({ classIds }) });\n        adminData = await api('/api/admin/overview');\n        courseStudentsModal = (adminData?.courses || []).find(c => c.id === courseId) || null;\n        render();\n        showToast('Added ' + n(res.enrolledCount) + ' student(s) from ' + n(res.classCount) + ' class(es)');\n      }, 'Could not add class students: ');\n      return;\n    }\n    if (form.id === 'admin-add-dept-form') {\n      run(async () => {\n        await api('/api/admin/departments', { method: 'POST', body: JSON.stringify({ name: values.name }) });\n        adminData = await api('/api/admin/overview'); render(); showToast('Department added');\n      }, 'Could not add department: ');\n      return;\n    }\n    if (form.id === 'admin-dept-form') {\n      run(async () => {\n        await api('/api/admin/users/' + encodeURIComponent(form.dataset.id) + '/department', { method: 'PATCH', body: JSON.stringify({ department: values.department, major: values.major }) });\n        deptDialogUser = null;\n        adminData = await api('/api/admin/overview'); render(); showToast('Department assignment updated');\n      }, 'Could not update department: ');\n      return;\n    }\n    if (form.id === 'admin-announcement-form') {\n      const editId = form.dataset.id;\n      run(async () => {\n        if (editId) {\n          await api('/api/admin/announcements/' + encodeURIComponent(editId), { method: 'PATCH', body: JSON.stringify({ category: values.category, title: values.title, content: values.content }) });\n        } else {\n          await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ category: values.category, title: values.title, content: values.content }) });\n        }\n        annEditItem = null;\n        adminData = await api('/api/admin/overview'); render(); showToast(editId ? 'Announcement updated' : 'Announcement published');\n      }, 'Could not save announcement: ');\n      return;\n    }\n    if (form.id === 'admin-add-teacher') {\n      run(async () => {\n        await api('/api/admin/teachers', {method:'POST',body:JSON.stringify({name:values.name,email:values.email,password:values.password,position:values.position||'教师',department:values.department||'',grade:values.grade||'',crossGrades:String(values.crossGrades||'').split(/[,，;；]/).map(x=>x.trim()).filter(Boolean)})});\n        adminData = await api('/api/admin/overview'); render(); showToast('教师账户创建成功');\n      }, '创建教师失败: ');\n      return;\n    }\n    if (form.id === 'admin-password-form') {\n      if (values.password !== values.confirm) { showToast('Passwords do not match', true); return; }\n      run(async () => {\n        await api('/api/admin/users/' + encodeURIComponent(form.dataset.id) + '/password', {method:'PATCH',body:JSON.stringify({password:values.password})});\n        adminDialog = null; render(); showToast('Password updated');\n      }, 'Could not update password: ');\n      return;\n    }\n    if (form.classList.contains('admin-enrollment-form')) {\n      const student = (adminData?.students || []).find(s => s.id === form.dataset.studentId);\n      const course = (adminData?.courses || []).find(c => c.id === values.courseId);\n      if (!student || !course || !confirm('Add ' + student.name + ' to ' + course.title + '?')) return;\n      run(async () => {\n        await api('/api/admin/students/' + encodeURIComponent(student.id) + '/enrollments/' + encodeURIComponent(course.id), {method:'POST'});\n        adminData = await api('/api/admin/overview'); render(); showToast('Student added to course');\n      }, 'Could not update enrollment: ');\n      return;\n    }\n    if (form.id === 'admin-course-add-students-form' || form.id === 'admin-course-remove-students-form') {\n      const courseId = form.dataset.courseId;\n      const isAdd = form.id === 'admin-course-add-students-form';\n      const fieldName = isAdd ? 'studentIds' : 'removeStudentIds';\n      const ids = new FormData(form).getAll(fieldName).map(String);\n      if (!ids.length) { showToast(isAdd ? 'Please select at least one student' : 'Please select at least one student to remove', true); return; }\n      const course = (adminData?.courses || []).find(c => c.id === courseId);\n      if (!course) return;\n      if (!confirm((isAdd ? 'Add ' : 'Remove ') + ids.length + ' student(s) ' + (isAdd ? 'to' : 'from') + ' ' + course.title + '?')) return;\n      run(async () => {\n        for (const studentId of ids) {\n          await api('/api/admin/students/' + encodeURIComponent(studentId) + '/enrollments/' + encodeURIComponent(courseId), { method: isAdd ? 'POST' : 'DELETE' });\n        }\n        adminData = await api('/api/admin/overview');\n        courseStudentsModal = (adminData?.courses || []).find(c => c.id === courseId) || null;\n        render();\n        showToast((isAdd ? 'Added ' : 'Removed ') + ids.length + ' student(s)');\n      }, 'Could not update course enrollment: ');\n    }\n  });\n\n  function applyAdminFilter(el, refocus) {\n    const key = el.dataset.adminFilter;\n    const val = el.value;\n    if (key === 'teacher-q') teacherFilter.q = val;\n    else if (key === 'teacher-department') teacherFilter.department = val;\n    else if (key === 'teacher-major') teacherFilter.major = val;\n    else if (key === 'teacher-status') teacherFilter.status = val;\n    else if (key === 'teacher-position') teacherFilter.position = val;\n    else if (key === 'student-q') studentFilter.q = val;\n    else if (key === 'student-department') studentFilter.department = val;\n    else if (key === 'student-major') studentFilter.major = val;\n    else if (key === 'student-gender') studentFilter.gender = val;\n    else if (key === 'student-class') studentFilter.classId = val;\n    else if (key === 'class-q') classFilter.q = val;\n    else if (key === 'class-department') classFilter.department = val;\n    else if (key === 'class-grade') classFilter.grade = val;\n    else if (key === 'course-q') courseFilter.q = val;\n    else if (key === 'course-department') { courseFilter.department = val; courseFilter.teacherId = ''; }\n    else if (key === 'course-teacher') courseFilter.teacherId = val;\n    else if (key === 'course-year') courseFilter.academicYear = val;\n    else if (key === 'course-discipline') courseFilter.discipline = val;\n    else if (key === 'course-group') courseFilter.groupBy = val;\n    const pos = refocus ? el.selectionStart : null;\n    const id = el.id;\n    render();\n    if (refocus && id) {\n      const nextEl = document.getElementById(id);\n      if (nextEl) { nextEl.focus(); if (pos != null) nextEl.setSelectionRange(pos, pos); }\n    }\n  }\n  document.addEventListener('input', event => {\n    if (event.target.dataset?.adminFilter && event.target.type === 'search') applyAdminFilter(event.target, true);\n  });\n  document.addEventListener('change', event => {\n    const teacherId = event.target.dataset?.adminTeacherPos;\n    if (teacherId) {\n      const position = event.target.value;\n      run(async () => {\n        await api('/api/admin/teachers/' + encodeURIComponent(teacherId) + '/position', { method: 'PATCH', body: JSON.stringify({ position }) });\n        adminData = await api('/api/admin/overview');\n        render();\n        showToast('已更新该教师职位为：' + position);\n      }, '更新职位失败: ');\n      return;\n    }\n    if (event.target.dataset?.adminFilter && event.target.tagName === 'SELECT') applyAdminFilter(event.target, false);\n  });\n})();\n"

const SCHEDULING_FRONTEND_PATCH = "/* scheduleCourseSyncPatch */\n(() => {\n  if (window.__scheduleCourseSyncPatch) return;\n  window.__scheduleCourseSyncPatch = true;\n  function addButton() {\n    const anchor = document.querySelector('[data-sched-action=\"auto-schedule\"]');\n    if (!anchor || document.querySelector('[data-sched-action=\"sync-courses\"]')) return;\n    const btn = document.createElement('button');\n    btn.type = 'button';\n    btn.className = 'btn btn-soft btn-sm';\n    btn.dataset.schedAction = 'sync-courses';\n    btn.textContent = '🔄 同步课程管理课程';\n    anchor.parentNode.insertBefore(btn, anchor.nextSibling);\n  }\n  document.addEventListener('click', async event => {\n    const button = event.target.closest('[data-sched-action=\"sync-courses\"]');\n    if (!button) return;\n    event.preventDefault(); event.stopPropagation();\n    button.disabled = true;\n    try {\n      const res = await fetch('/api/admin/schedule/sync-courses', { method: 'POST', credentials: 'same-origin' });\n      const data = await res.json();\n      if (!res.ok) throw new Error(data.error || '同步失败');\n      if (typeof showToast === 'function') showToast('课程已同步到排课系统'); else alert('课程已同步到排课系统');\n      setTimeout(() => location.reload(), 300);\n    } catch (err) {\n      if (typeof showToast === 'function') showToast(err.message, true); else alert(err.message);\n      button.disabled = false;\n    }\n  }, true);\n  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton); else addButton();\n  new MutationObserver(addButton).observe(document.documentElement, { childList: true, subtree: true });\n})();\n";

const SCHEDULING_JS_FULL = "// 51-style Intelligent Course Scheduling Workspace (Admin) & Personal Timetable (Teacher/Student).\n(() => {\n  const DAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];\n  const PREFS_KEY = 'zhixing_timetable_prefs';\n  function loadPrefs() {\n    try {\n      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null;\n      if (raw) return { displayMode: 'course_teacher_room', rowHeight: 'standard', fontSize: 'md', showWeekend: false, ...JSON.parse(raw) };\n    } catch {}\n    return { displayMode: 'course_teacher_room', rowHeight: 'standard', fontSize: 'md', showWeekend: false };\n  }\n  function savePrefs(prefs) {\n    try { if (typeof localStorage !== 'undefined') localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}\n  }\n\n  window.schedUI = {\n    subTab: 'timetable', // timetable | basedata | approvals\n    viewMode: 'class',   // class | teacher | room | overview | conflicts\n    selectedClassId: '',\n    selectedTeacherId: '',\n    selectedRoomId: '',\n    selectedRuleTeacherId: '',\n    courseFilter: { department: '', grade: '', major: '', courseIds: [] },\n    data: null,\n    loading: false,\n    error: '',\n    dragEntryId: null,\n    addSlot: null, // { day, periodId }\n    conflictModal: null,\n    myData: null,\n    myLoading: false,\n    examView: 'plan',\n    selectedExamId: '',\n    optionsOpen: false,\n    prefs: loadPrefs(),\n  };\n\n  function getDisplayLines(e, scope, teachers) {\n    const subj = scope.subjects.find(s => s.id === e.subjectId)?.name || '课程';\n    const tch = teachers.find(t => t.id === e.teacherId)?.name || '';\n    const rm = scope.rooms.find(r => r.id === e.roomId)?.name || '';\n    const mode = schedUI.prefs.displayMode || 'course_teacher_room';\n    if (mode === 'course') return [subj];\n    if (mode === 'course_teacher') return [subj, tch].filter(Boolean);\n    if (mode === 'teacher') return [tch || '未指定教师'];\n    if (mode === 'room') return [rm || '未指定教室'];\n    return [subj, tch, rm].filter(Boolean);\n  }\n  function getStyleMetrics() {\n    const pad = schedUI.prefs.rowHeight === 'compact' ? '4px 6px' : schedUI.prefs.rowHeight === 'relaxed' ? '11px 10px' : '7px 9px';\n    const font = schedUI.prefs.fontSize === 'sm' ? '11px' : schedUI.prefs.fontSize === 'lg' ? '15px' : '13px';\n    return { pad, font };\n  }\n  function getDayNames(days) {\n    const count = schedUI.prefs.showWeekend ? Math.max(Number(days || 5), 7) : Number(days || 5);\n    return Array.from({ length: count }, (_, i) => ({ day: i + 1, label: DAYS[i + 1] || ('周' + (i + 1)) }));\n  }\n\n  async function loadAdminSchedule() {\n    if (schedUI.loading) return;\n    schedUI.loading = true;\n    try {\n      schedUI.data = await api('/api/admin/schedule');\n      schedUI.error = '';\n      const sc = schedUI.data.scope;\n      if (!schedUI.selectedClassId && sc.classes.length) schedUI.selectedClassId = sc.classes[0].id;\n      if (!schedUI.selectedTeacherId && schedUI.data.teachers.length) schedUI.selectedTeacherId = schedUI.data.teachers[0].id;\n      if (!schedUI.selectedRoomId && sc.rooms.length) schedUI.selectedRoomId = sc.rooms[0].id;\n      if (!schedUI.selectedRuleTeacherId && schedUI.data.teachers.length) schedUI.selectedRuleTeacherId = schedUI.data.teachers[0].id;\n    } catch (err) {\n      schedUI.error = err.message;\n    } finally {\n      schedUI.loading = false;\n      render();\n    }\n  }\n\n  async function refreshAdminSchedule() {\n    schedUI.data = await api('/api/admin/schedule');\n    const sc = schedUI.data.scope;\n    if (!schedUI.selectedClassId && sc.classes.length) schedUI.selectedClassId = sc.classes[0].id;\n    if (!schedUI.selectedTeacherId && schedUI.data.teachers.length) schedUI.selectedTeacherId = schedUI.data.teachers[0].id;\n    if (!schedUI.selectedRoomId && sc.rooms.length) schedUI.selectedRoomId = sc.rooms[0].id;\n    render();\n  }\n\n  async function loadMyTimetable() {\n    if (schedUI.myLoading) return;\n    schedUI.myLoading = true;\n    try {\n      schedUI.myData = await api('/api/schedule/my');\n    } catch (err) {\n      showToast(err.message, true);\n    } finally {\n      schedUI.myLoading = false;\n      render();\n    }\n  }\n\n  function renderCellCard(e, scope, teachers, conflictSet) {\n    const lines = getDisplayLines(e, scope, teachers);\n    const { pad, font } = getStyleMetrics();\n    const hasConflict = conflictSet.has(e.id);\n    const border = hasConflict ? '2px solid #dc2626' : e.temporary ? '1.5px dashed #3b82f6' : '1px solid var(--border)';\n    const bg = hasConflict ? '#fef2f2' : e.locked ? '#f8fafc' : '#fff';\n    return '<div draggable=\"' + (!e.locked) + '\" data-sched-entry=\"' + esc(e.id) + '\" style=\"padding:' + pad + ';font-size:' + font + ';border-radius:8px;border:' + border + ';background:' + bg + ';cursor:' + (e.locked ? 'default' : 'grab') + ';margin-bottom:4px\">' +\n      '<div class=\"row-between\" style=\"gap:4px\"><strong>' + esc(lines[0] || '') + '</strong>' +\n      '<span>' + (e.locked ? '🔒' : '') + (e.groupId ? '<span class=\"pill\" style=\"background:#ede9fe;color:#5b21b6;font-size:10px;padding:1px 5px\">合班</span>' : '') + (e.temporary ? '<span class=\"pill blue\" style=\"font-size:10px;padding:1px 5px\">临时</span>' : '') + (hasConflict ? '<span class=\"pill\" style=\"background:#fee2e2;color:#b91c1c;font-size:10px;padding:1px 5px\">冲突</span>' : '') + '</span></div>' +\n      (lines.length > 1 ? '<div class=\"tiny muted\" style=\"white-space:pre-line\">' + esc(lines.slice(1).join('\\n')) + '</div>' : '') +\n      '<div class=\"row\" style=\"gap:6px;margin-top:4px\">' +\n      '<button type=\"button\" class=\"btn-text\" style=\"font-size:11px;padding:0\" data-sched-action=\"toggle-lock\" data-id=\"' + esc(e.id) + '\">' + (e.locked ? '解锁' : '锁定') + '</button>' +\n      '<button type=\"button\" class=\"btn-text\" style=\"font-size:11px;padding:0;color:#dc2626\" data-sched-action=\"delete-entry\" data-id=\"' + esc(e.id) + '\">删除</button>' +\n      '</div></div>';\n  }\n\n  function renderTimetableGrid(scope, teachers, entries, filterType, targetId, conflictSet) {\n    const days = getDayNames(scope.settings.daysPerWeek);\n    const periods = scope.settings.periods || [];\n    const blockedSet = new Set((scope.settings.blockedSlots || []).map(b => b.key));\n    const header = '<tr><th style=\"width:110px\">节次 / 时间</th>' + days.map(d => '<th>' + d.label + '</th>').join('') + '</tr>';\n    const rows = periods.map(p => {\n      if (p.isBreak) {\n        return '<tr style=\"background:#f3f4f6\"><td colspan=\"' + (days.length + 1) + '\" style=\"text-align:center;color:#6b7280;font-size:12px;padding:6px\"><strong>' + esc(p.name) + '</strong> (' + esc(p.startTime) + '–' + esc(p.endTime) + ') · ' + esc(p.breakLabel || '不上课') + '</td></tr>';\n      }\n      const cells = days.map(d => {\n        const key = d.day + '-' + p.id;\n        if (blockedSet.has(key)) {\n          return '<td style=\"background:#f3f4f6;color:#9ca3af;text-align:center;font-size:12px\">全校锁定</td>';\n        }\n        const cellEntries = entries.filter(e => Number(e.day) === d.day && e.periodId === p.id);\n        const groupActs = filterType === 'teacher' && targetId ? (scope.groupBlocks || []).filter(gb => {\n          if (gb.active === false || Number(gb.day) !== d.day || !(gb.periodIds || []).includes(p.id)) return false;\n          const grp = (scope.teacherGroups || []).find(g => g.id === gb.groupId);\n          return grp && (grp.teacherIds || []).includes(targetId);\n        }) : [];\n        const actBadges = groupActs.map(gb => {\n          const grpName = (scope.teacherGroups || []).find(g => g.id === gb.groupId)?.name || '';\n          return '<div style=\"padding:5px 7px;border-radius:6px;background:' + esc(gb.color || '#fef3c7') + ';font-size:12px;margin-bottom:4px\"><strong>' + esc(gb.icon || '🔔') + ' ' + esc(gb.label || gb.activityType) + '</strong><div class=\"tiny muted\">' + esc(grpName) + '</div></div>';\n        }).join('');\n        const content = (cellEntries.length || actBadges)\n          ? actBadges + cellEntries.map(e => renderCellCard(e, scope, teachers, conflictSet)).join('')\n          : '<div class=\"tiny muted\" style=\"text-align:center;padding:8px 0\">' + (filterType === 'teacher' ? '无课' : '<button type=\"button\" class=\"btn-text\" style=\"font-size:11px\" data-sched-action=\"open-add-slot\" data-day=\"' + d.day + '\" data-period=\"' + esc(p.id) + '\">+ 排课</button>') + '</div>';\n        return '<td data-sched-drop=\"1\" data-day=\"' + d.day + '\" data-period=\"' + esc(p.id) + '\" style=\"vertical-align:top;min-width:130px\">' + content + '</td>';\n      }).join('');\n      return '<tr><td><strong>' + esc(p.name) + '</strong><br><span class=\"tiny muted\">' + esc(p.startTime) + '–' + esc(p.endTime) + '</span></td>' + cells + '</tr>';\n    }).join('');\n    return '<div class=\"table-wrap\"><table class=\"data-table\" style=\"border-collapse:collapse\"><thead>' + header + '</thead><tbody>' + rows + '</tbody></table></div>';\n  }\n\n  function renderOptionsDropdown() {\n    const pr = schedUI.prefs;\n    const modes = [\n      ['course', '只显示课程名称'],\n      ['course_teacher', '显示课程名称 + 教师'],\n      ['course_teacher_room', '显示课程名称 + 教师 + 教室'],\n      ['teacher', '仅显示教师名称'],\n      ['room', '仅显示教室名称'],\n    ];\n    return '<div style=\"position:relative;display:inline-block\">' +\n      '<button type=\"button\" class=\"btn btn-light btn-sm\" data-sched-action=\"toggle-options\">⚙ 课表选项 ▾</button>' +\n      (schedUI.optionsOpen ? '<div class=\"panel panel-pad\" style=\"position:absolute;left:0;top:110%;z-index:50;min-width:255px;box-shadow:0 12px 32px rgba(15,23,42,.15)\">' +\n        '<div class=\"tiny muted\" style=\"margin-bottom:6px\"><strong>显示内容（实时生效）</strong></div>' +\n        modes.map(([k, label]) => '<label style=\"display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;cursor:pointer\"><input type=\"radio\" name=\"schedDisplayMode\" data-sched-pref=\"displayMode\" value=\"' + k + '\"' + (pr.displayMode === k ? ' checked' : '') + '><span>' + label + '</span></label>').join('') +\n        '<hr style=\"margin:8px 0;border:0;border-top:1px solid var(--border)\">' +\n        '<div class=\"tiny muted\" style=\"margin-bottom:6px\"><strong>📐 样式设置</strong></div>' +\n        '<div class=\"field\" style=\"margin-bottom:8px\"><label class=\"tiny\">行高</label><select data-sched-pref=\"rowHeight\"><option value=\"compact\"' + (pr.rowHeight==='compact'?' selected':'') + '>紧凑</option><option value=\"standard\"' + (pr.rowHeight==='standard'?' selected':'') + '>标准</option><option value=\"relaxed\"' + (pr.rowHeight==='relaxed'?' selected':'') + '>宽松</option></select></div>' +\n        '<div class=\"field\" style=\"margin-bottom:8px\"><label class=\"tiny\">字体大小</label><select data-sched-pref=\"fontSize\"><option value=\"sm\"' + (pr.fontSize==='sm'?' selected':'') + '>小</option><option value=\"md\"' + (pr.fontSize==='md'?' selected':'') + '>中</option><option value=\"lg\"' + (pr.fontSize==='lg'?' selected':'') + '>大</option></select></div>' +\n        '<label style=\"display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer\"><input type=\"checkbox\" data-sched-pref=\"showWeekend\"' + (pr.showWeekend ? ' checked' : '') + '><span>显示周末 (周六/日)</span></label>' +\n        '</div>' : '') +\n      '</div>';\n  }\n\n  function exportWysiwygExcel(d) {\n    const scope = d.scope;\n    const teachers = d.teachers || [];\n    const conflicts = d.conflicts || [];\n    const conflictSet = new Set(conflicts.filter(c => c.hard.length).map(c => c.entryId));\n    const days = getDayNames(scope.settings.daysPerWeek);\n    const periods = scope.settings.periods || [];\n    const blockedSet = new Set((scope.settings.blockedSlots || []).map(b => b.key));\n    const { pad, font } = getStyleMetrics();\n    const targetClasses = schedUI.viewMode === 'class' && schedUI.selectedClassId\n      ? scope.classes.filter(c => c.id === schedUI.selectedClassId)\n      : scope.classes;\n    let tables = '';\n    for (const cls of targetClasses) {\n      const entries = scope.entries.filter(e => e.classId === cls.id);\n      let rows = '<tr><th style=\"background:#eef2ff;border:1px solid #cbd5e1;padding:6px\">节次 / 时间</th>' +\n        days.map(day => '<th style=\"background:' + (day.day >= 6 ? '#f1f5f9' : '#eef2ff') + ';border:1px solid #cbd5e1;padding:6px\">' + day.label + '</th>').join('') + '</tr>';\n      for (const p of periods) {\n        if (p.isBreak) {\n          rows += '<tr><td colspan=\"' + (days.length + 1) + '\" style=\"background:#f3f4f6;color:#6b7280;text-align:center;border:1px solid #cbd5e1;padding:4px\">' + esc(p.name) + ' (' + esc(p.startTime + '-' + p.endTime) + ')</td></tr>';\n          continue;\n        }\n        const cells = days.map(day => {\n          const key = day.day + '-' + p.id;\n          if (blockedSet.has(key)) return '<td style=\"background:#e5e7eb;border:1px solid #cbd5e1;text-align:center\">锁定</td>';\n          const list = entries.filter(e => Number(e.day) === day.day && e.periodId === p.id);\n          if (!list.length) return '<td style=\"border:1px solid #cbd5e1;background:' + (day.day >= 6 ? '#f8fafc' : '#ffffff') + ';padding:' + pad + '\"></td>';\n          const hasC = list.some(e => conflictSet.has(e.id));\n          const bg = hasC ? '#fef2f2' : day.day >= 6 ? '#f8fafc' : '#ffffff';\n          const text = list.map(e => getDisplayLines(e, scope, teachers).map(esc).join('<br>')).join('<hr>');\n          return '<td style=\"border:1px solid #cbd5e1;background:' + bg + ';padding:' + pad + ';font-size:' + font + ';vertical-align:top\">' + text + '</td>';\n        }).join('');\n        rows += '<tr><td style=\"border:1px solid #cbd5e1;background:#f8fafc;padding:' + pad + '\"><b>' + esc(p.name) + '</b><br>' + esc(p.startTime + '-' + p.endTime) + '</td>' + cells + '</tr>';\n      }\n      tables += '<h3>' + esc(cls.name) + '</h3><table style=\"border-collapse:collapse;margin-bottom:18px\">' + rows + '</table>';\n    }\n    const html = '<html xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:x=\"urn:schemas-microsoft-com:office:excel\"><head><meta charset=\"utf-8\"><style>@page{size:landscape;margin:10mm}td,th{mso-number-format:\"\\@\";}</style></head><body>' + tables + '</body></html>';\n    const blob = new Blob(['\\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });\n    const a = document.createElement('a');\n    a.href = URL.createObjectURL(blob);\n    a.download = 'zhixing-timetable-wysiwyg.xls';\n    document.body.appendChild(a);\n    a.click();\n    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);\n  }\n\n  function renderTimetableTab(d) {\n    const scope = d.scope;\n    const teachers = d.teachers || [];\n    const conflicts = d.conflicts || [];\n    const conflictSet = new Set(conflicts.filter(c => c.hard.length).map(c => c.entryId));\n    const toolbar = '<section class=\"panel panel-pad\" style=\"margin-bottom:16px\"><div class=\"row-between wrap\" style=\"gap:10px\">' +\n      '<div class=\"row wrap\" style=\"gap:8px\">' +\n      renderOptionsDropdown() +\n      '<button type=\"button\" class=\"btn btn-primary btn-sm\" data-sched-action=\"auto-schedule\">⚡ 一键智能排课</button>' +\n      '<button type=\"button\" class=\"btn btn-soft btn-sm\" data-sched-action=\"publish-schedule\">📢 发布同步给师生</button>' +\n      '<button type=\"button\" class=\"btn btn-light btn-sm\" data-sched-action=\"export-wysiwyg\">⬇ 导出全校总课表 (Excel)</button>' +\n      '<a class=\"btn btn-light btn-sm\" href=\"/api/admin/schedule/export\" download=\"zhixing-timetable.csv\">⬇ CSV</a>' +\n      '<button type=\"button\" class=\"btn btn-light btn-sm\" onclick=\"window.print()\">🖨 打印 / 存PDF</button>' +\n      '<button type=\"button\" class=\"btn btn-light btn-sm\" data-sched-action=\"archive-schedule\">📦 保存存档</button>' +\n      '</div><div class=\"tiny muted\">' + (scope.published ? '已发布：' + fmtDate(scope.published.publishedAt) : '尚未发布给师生') + ' · 共 ' + scope.entries.length + ' 节课 · 冲突 ' + conflictSet.size + ' 项</div></div></section>';\n\n    const courseOptions = d.courseOptions || [];\n    const cf = schedUI.courseFilter;\n    const collegeSet = [...new Set(courseOptions.map(c => c.ownerDepartment).filter(Boolean))].sort();\n    const gradeSet = [...new Set(courseOptions.map(c => c.academicYear).filter(Boolean))].sort();\n    const majorSet = [...new Set(courseOptions.flatMap(c => c.targetMajors || []).filter(Boolean))].sort();\n    const matchedCourses = courseOptions.filter(c =>\n      (!cf.department || c.ownerDepartment === cf.department) &&\n      (!cf.grade || c.academicYear === cf.grade) &&\n      (!cf.major || (c.targetMajors || []).includes(cf.major)));\n    const coursePicker = '<section class=\"panel panel-pad\" style=\"margin-bottom:16px\"><h3 style=\"margin:0 0 8px\">按 学院 → 年级 → 专业 选择课程</h3>' +\n      '<div class=\"row wrap\" style=\"gap:8px\"><select data-sched-course-filter=\"department\" aria-label=\"学院\"><option value=\"\">所有学院</option>' + collegeSet.map(x => '<option value=\"' + esc(x) + '\"' + (cf.department === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' +\n      '<select data-sched-course-filter=\"grade\" aria-label=\"年级\"><option value=\"\">所有年级</option>' + gradeSet.map(x => '<option value=\"' + esc(x) + '\"' + (cf.grade === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' +\n      '<select data-sched-course-filter=\"major\" aria-label=\"专业\"><option value=\"\">所有专业</option>' + majorSet.map(x => '<option value=\"' + esc(x) + '\"' + (cf.major === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' +\n      '<button type=\"button\" class=\"btn btn-primary btn-sm\" data-sched-action=\"auto-schedule-selected\">🚀 按所选课程一键排课</button>' +\n      '<span class=\"tiny muted\">匹配到 ' + matchedCourses.length + ' 门课程，已选 ' + cf.courseIds.length + ' 门</span></div>' +\n      '<div class=\"field\" style=\"margin-top:10px\"><label>本专业课程（可多选，不选则使用全部匹配课程）</label>' +\n      '<select multiple size=\"4\" data-sched-course-filter=\"courseIds\" style=\"width:100%;min-height:90px\">' +\n      (matchedCourses.length ? matchedCourses.map(c => '<option value=\"' + esc(c.id) + '\"' + (cf.courseIds.includes(c.id) ? ' selected' : '') + '>' + esc(c.title) + (c.enrollmentCode ? ' · ' + esc(c.enrollmentCode) : '') + (c.courseType === 'normal' ? ' · 普通课程' : '') + '</option>').join('') : '<option value=\"\">该条件下暂无课程</option>') +\n      '</select></div></section>';\n\n    const viewPills = '<div class=\"filter-pills\" style=\"margin-bottom:14px\">' +\n      [['class', '🏫 班级课表'], ['teacher', '👨‍🏫 教师课表'], ['room', '🏢 教室课表'], ['overview', '📅 全校总览'], ['conflicts', '⚠ 冲突报告 (' + conflicts.length + ')']]\n        .map(([k, label]) => '<button type=\"button\" class=\"' + (schedUI.viewMode === k ? 'active' : '') + '\" data-sched-action=\"view-mode\" data-mode=\"' + k + '\">' + label + '</button>').join('') +\n      '</div>';\n\n    let bodyHtml = '';\n    if (schedUI.viewMode === 'class') {\n      const sel = '<div class=\"row wrap\" style=\"margin-bottom:12px\"><label class=\"small\"><strong>选择班级：</strong></label><select data-sched-select=\"class\">' +\n        (scope.classes.length ? scope.classes.map(c => '<option value=\"' + esc(c.id) + '\"' + (schedUI.selectedClassId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') : '<option value=\"\">请先在基础数据中添加班级</option>') +\n        '</select><span class=\"tiny muted\">提示：可直接拖拽两节课互换位置，系统自动校验冲突</span></div>';\n      const list = scope.entries.filter(e => e.classId === schedUI.selectedClassId);\n      bodyHtml = sel + renderTimetableGrid(scope, teachers, list, 'class', schedUI.selectedClassId, conflictSet);\n    } else if (schedUI.viewMode === 'teacher') {\n      const sel = '<div class=\"row wrap\" style=\"margin-bottom:12px\"><label class=\"small\"><strong>选择教师：</strong></label><select data-sched-select=\"teacher\">' +\n        (teachers.length ? teachers.map(t => '<option value=\"' + esc(t.id) + '\"' + (schedUI.selectedTeacherId === t.id ? ' selected' : '') + '>' + esc(t.name) + (t.department ? ' · ' + esc(t.department) : '') + '</option>').join('') : '<option value=\"\">暂无教师</option>') +\n        '</select></div>';\n      const list = scope.entries.filter(e => e.teacherId === schedUI.selectedTeacherId);\n      bodyHtml = sel + renderTimetableGrid(scope, teachers, list, 'teacher', schedUI.selectedTeacherId, conflictSet);\n    } else if (schedUI.viewMode === 'room') {\n      const sel = '<div class=\"row wrap\" style=\"margin-bottom:12px\"><label class=\"small\"><strong>选择教室：</strong></label><select data-sched-select=\"room\">' +\n        (scope.rooms.length ? scope.rooms.map(r => '<option value=\"' + esc(r.id) + '\"' + (schedUI.selectedRoomId === r.id ? ' selected' : '') + '>' + esc(r.name) + ' (' + esc(r.type) + ')</option>').join('') : '<option value=\"\">请先添加教室</option>') +\n        '</select></div>';\n      const list = scope.entries.filter(e => e.roomId === schedUI.selectedRoomId);\n      bodyHtml = sel + renderTimetableGrid(scope, teachers, list, 'room', schedUI.selectedRoomId, conflictSet);\n    } else if (schedUI.viewMode === 'overview') {\n      bodyHtml = scope.classes.length\n        ? scope.classes.map(c => '<div style=\"margin-bottom:20px\"><h3 style=\"margin:0 0 8px\">' + esc(c.name) + '</h3>' +\n          renderTimetableGrid(scope, teachers, scope.entries.filter(e => e.classId === c.id), 'class', c.id, conflictSet) + '</div>').join('')\n        : em('暂无班级数据', '请先到“基础数据管理”添加年级、班级、科目与授课计划。');\n    } else {\n      bodyHtml = conflicts.length\n        ? conflicts.map(c => {\n          const cls = scope.classes.find(x => x.id === c.classId)?.name || '';\n          const sub = scope.subjects.find(x => x.id === c.subjectId)?.name || '';\n          const tch = teachers.find(x => x.id === c.teacherId)?.name || '';\n          return '<div class=\"panel panel-pad\" style=\"margin-bottom:10px;border-left:4px solid ' + (c.hard.length ? '#dc2626' : '#eab308') + '\">' +\n            '<strong>' + esc(cls) + ' · ' + esc(sub) + ' · ' + esc(tch) + ' (周' + c.day + ' ' + esc(c.periodId) + ')</strong>' +\n            c.hard.map(h => '<div class=\"small\" style=\"color:#b91c1c\">🔴 [' + esc(h.code) + '] ' + esc(h.message) + '</div>').join('') +\n            c.warnings.map(w => '<div class=\"small\" style=\"color:#a16207\">🟡 [' + esc(w.code) + '] ' + esc(w.message) + '</div>').join('') +\n            '</div>';\n        }).join('')\n        : '<div class=\"panel panel-pad\"><p class=\"small\" style=\"color:#15803d;margin:0\">✅ 当前课表零硬冲突、无规则告警！</p></div>';\n    }\n    return toolbar + coursePicker + '<section class=\"panel panel-pad\">' + viewPills + bodyHtml + '</section>';\n  }\n\n  function renderBaseDataTab(d) {\n    const scope = d.scope;\n    const teachers = d.teachers || [];\n    const students = d.students || [];\n    const days = getDayNames(scope.settings.daysPerWeek);\n    const tPeriods = (scope.settings.periods || []).filter(p => !p.isBreak);\n    const tr = scope.teacherRules[schedUI.selectedRuleTeacherId] || { blockedSlots: [], maxDailyPeriods: 0, preference: 'any' };\n\n    return '<div class=\"form-grid\" style=\"align-items:start\">' +\n      // 1. Settings & Grades\n      '<section class=\"panel panel-pad\"><h3>1. 学校作息与年级</h3>' +\n      '<form id=\"sched-settings-form\"><div class=\"form-grid\">' +\n      '<div class=\"field\"><label>学段</label><select name=\"schoolLevel\"><option value=\"小学\"' + (scope.settings.schoolLevel==='小学'?' selected':'') + '>小学</option><option value=\"初中\"' + (scope.settings.schoolLevel==='初中'?' selected':'') + '>初中</option><option value=\"高中\"' + (scope.settings.schoolLevel==='高中'?' selected':'') + '>高中</option><option value=\"大学/职校\"' + (scope.settings.schoolLevel==='大学/职校'?' selected':'') + '>大学/职校</option></select></div>' +\n      '<div class=\"field\"><label>每周上课天数</label><select name=\"daysPerWeek\"><option value=\"5\"' + (scope.settings.daysPerWeek===5?' selected':'') + '>5天</option><option value=\"6\"' + (scope.settings.daysPerWeek===6?' selected':'') + '>6天</option></select></div>' +\n      '<div class=\"field\"><label>校区名称</label><input name=\"campusName\" value=\"' + esc(scope.settings.campusName || '主校区') + '\"></div></div>' +\n      '<button type=\"submit\" class=\"btn btn-soft btn-sm\">保存作息设置</button></form>' +\n      '<hr style=\"margin:14px 0;border:0;border-top:1px solid var(--border)\">' +\n      '<form id=\"sched-grade-form\"><div class=\"row wrap\"><input name=\"name\" placeholder=\"年级名 (如 高一)\" required style=\"max-width:160px\"><input name=\"maxWeeklyPeriods\" type=\"number\" value=\"40\" min=\"1\" max=\"60\" style=\"max-width:90px\"><button type=\"submit\" class=\"btn btn-primary btn-sm\">+ 添加年级</button></div></form>' +\n      '<div class=\"row wrap\" style=\"gap:6px;margin-top:8px\">' + scope.grades.map(g => '<span class=\"pill blue\">' + esc(g.name) + ' <button type=\"button\" data-sched-action=\"del-grade\" data-id=\"' + esc(g.id) + '\" style=\"border:0;background:none;color:inherit;cursor:pointer\">×</button></span>').join('') + '</div></section>' +\n\n      // 2. Classes\n      '<section class=\"panel panel-pad\"><h3>2. 班级管理 (行政班/走班)</h3>' +\n      '<form id=\"sched-class-form\"><div class=\"form-grid\">' +\n      '<div class=\"field\"><label>班级名称 *</label><input name=\"name\" placeholder=\"如 高一(1)班\" required></div>' +\n      '<div class=\"field\"><label>所属年级</label><select name=\"gradeId\"><option value=\"\">不限</option>' + scope.grades.map(g => '<option value=\"' + esc(g.id) + '\">' + esc(g.name) + '</option>').join('') + '</select></div>' +\n      '<div class=\"field\"><label>类型</label><select name=\"type\"><option value=\"admin\">行政班</option><option value=\"elective\">走班班</option><option value=\"interest\">兴趣班</option></select></div></div>' +\n      '<button type=\"submit\" class=\"btn btn-primary btn-sm\">+ 添加班级</button></form>' +\n      '<div style=\"margin-top:10px\">' + scope.classes.map(c => '<div class=\"student-detail-row\"><span><strong>' + esc(c.name) + '</strong> (' + esc(c.type) + ') · 学生 ' + (c.studentIds?.length || 0) + ' 人</span>' +\n        '<div class=\"row\"><button type=\"button\" class=\"btn btn-danger btn-sm\" data-sched-action=\"del-class\" data-id=\"' + esc(c.id) + '\">删除</button></div></div>').join('') + '</div></section>' +\n\n      // 3. Subjects\n      '<section class=\"panel panel-pad\"><h3>3. 科目与连堂规则</h3>' +\n      '<form id=\"sched-subject-form\"><div class=\"form-grid\">' +\n      '<div class=\"field\"><label>科目名称 *</label><input name=\"name\" placeholder=\"如 语文 / 数学\" required></div>' +\n      '<div class=\"field\"><label>类别</label><select name=\"tier\"><option value=\"major\">主课</option><option value=\"minor\">副科</option><option value=\"public\">公共课</option></select></div>' +\n      '<div class=\"field\"><label>默认周课时</label><input name=\"weeklyHours\" type=\"number\" value=\"4\" min=\"1\" max=\"30\"></div>' +\n      '<div class=\"field\"><label>时段偏好</label><select name=\"preference\"><option value=\"any\">不限</option><option value=\"morning\">上午优先</option><option value=\"afternoon\">下午优先</option></select></div>' +\n      '<div class=\"field\"><label>连堂设置</label><select name=\"consecutiveMode\"><option value=\"none\">不连堂</option><option value=\"allow\">允许连堂</option><option value=\"require\">必须连堂(2节)</option></select></div></div>' +\n      '<button type=\"submit\" class=\"btn btn-primary btn-sm\">+ 添加科目</button></form>' +\n      '<div class=\"row wrap\" style=\"gap:6px;margin-top:10px\">' + scope.subjects.map(s => '<span class=\"pill blue\">' + esc(s.name) + ' (' + s.weeklyHours + '节/周' + (s.consecutiveMode === 'require' ? '·连堂' : '') + ') <button type=\"button\" data-sched-action=\"del-subject\" data-id=\"' + esc(s.id) + '\" style=\"border:0;background:none;color:inherit;cursor:pointer\">×</button></span>').join('') + '</div></section>' +\n\n      // 4. Rooms\n      '<section class=\"panel panel-pad\"><h3>4. 教室 / 场地资源</h3>' +\n      '<form id=\"sched-room-form\"><div class=\"row wrap\">' +\n      '<input name=\"name\" placeholder=\"如 101教室 / 物理实验室\" required style=\"max-width:190px\">' +\n      '<select name=\"type\"><option value=\"normal\">普通教室</option><option value=\"lab\">实验室</option><option value=\"computer\">计算机室</option><option value=\"gym\">体育场馆</option></select>' +\n      '<input name=\"capacity\" type=\"number\" value=\"50\" min=\"1\" style=\"max-width:80px\">' +\n      '<button type=\"submit\" class=\"btn btn-primary btn-sm\">+ 添加教室</button></div></form>' +\n      '<div class=\"row wrap\" style=\"gap:6px;margin-top:10px\">' + scope.rooms.map(r => '<span class=\"pill blue\">' + esc(r.name) + ' (' + r.capacity + '座) <button type=\"button\" data-sched-action=\"del-room\" data-id=\"' + esc(r.id) + '\" style=\"border:0;background:none;color:inherit;cursor:pointer\">×</button></span>').join('') + '</div></section>' +\n      '</div>' +\n\n      // 5. Teaching Plans (Class + Subject + Teacher + Room + Hours + Fixed)\n      '<section class=\"panel panel-pad\" style=\"margin-top:16px\"><h3>5. 授课分配计划（教师-班级-科目匹配）</h3>' +\n      '<form id=\"sched-plan-form\"><div class=\"form-grid\">' +\n      '<div class=\"field\"><label>班级 *</label><select name=\"classId\" required>' + scope.classes.map(c => '<option value=\"' + esc(c.id) + '\">' + esc(c.name) + '</option>').join('') + '</select></div>' +\n      '<div class=\"field\"><label>科目 *</label><select name=\"subjectId\" required>' + scope.subjects.map(s => '<option value=\"' + esc(s.id) + '\">' + esc(s.name) + '</option>').join('') + '</select></div>' +\n      '<div class=\"field\"><label>任课教师 *</label><select name=\"teacherId\" required>' + teachers.map(t => '<option value=\"' + esc(t.id) + '\">' + esc(t.name) + '</option>').join('') + '</select></div>' +\n      '<div class=\"field\"><label>教室 (可选)</label><select name=\"roomId\"><option value=\"\">不指定</option>' + scope.rooms.map(r => '<option value=\"' + esc(r.id) + '\">' + esc(r.name) + '</option>').join('') + '</select></div>' +\n      '<div class=\"field\"><label>周课时 *</label><input name=\"weeklyHours\" type=\"number\" value=\"4\" min=\"1\" max=\"30\" required></div>' +\n      '<div class=\"field\"><label style=\"display:flex;align-items:center;gap:6px;margin-top:26px\"><input type=\"checkbox\" name=\"fixed\" value=\"1\"> 固定优先排课</label></div></div>' +\n      '<button type=\"submit\" class=\"btn btn-primary btn-sm\">+ 添加授课计划</button></form>' +\n      '<div style=\"margin-top:12px\">' + (scope.plans.length ? scope.plans.map(p => {\n        const cls = scope.classes.find(c => c.id === p.classId)?.name || '';\n        const sub = scope.subjects.find(s => s.id === p.subjectId)?.name || '';\n        const tch = teachers.find(t => t.id === p.teacherId)?.name || '';\n        const rm = scope.rooms.find(r => r.id === p.roomId)?.name || '';\n        return '<div class=\"student-detail-row\"><span><strong>' + esc(cls) + '</strong> · ' + esc(sub) + ' · ' + esc(tch) + (rm ? ' · ' + esc(rm) : '') + ' · <b>' + p.weeklyHours + '节/周</b>' + (p.fixed ? ' <span class=\"pill blue\">固定优先</span>' : '') + '</span>' +\n          '<button type=\"button\" class=\"btn btn-danger btn-sm\" data-sched-action=\"del-plan\" data-id=\"' + esc(p.id) + '\">移除</button></div>';\n      }).join('') : '<p class=\"small muted\">尚未添加授课分配计划。</p>') + '</div></section>' +\n\n      // 6. Teacher Availability & Constraints\n      '<section class=\"panel panel-pad\" style=\"margin-top:16px\"><h3>6. 教师不可排时段与单日上限</h3>' +\n      '<div class=\"row wrap\" style=\"margin-bottom:10px\"><label class=\"small\">选择教师：</label><select data-sched-select=\"rule-teacher\">' +\n      teachers.map(t => '<option value=\"' + esc(t.id) + '\"' + (schedUI.selectedRuleTeacherId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') +\n      '</select></div>' +\n      (schedUI.selectedRuleTeacherId ? '<form id=\"sched-teacher-rule-form\"><div class=\"form-grid\">' +\n        '<div class=\"field\"><label>单日排课上限 (0为不限)</label><input name=\"maxDailyPeriods\" type=\"number\" min=\"0\" max=\"15\" value=\"' + n(tr.maxDailyPeriods) + '\"></div>' +\n        '<div class=\"field\"><label>时段偏好</label><select name=\"preference\"><option value=\"any\"' + (tr.preference==='any'?' selected':'') + '>不限</option><option value=\"morning\"' + (tr.preference==='morning'?' selected':'') + '>上午优先</option><option value=\"afternoon\"' + (tr.preference==='afternoon'?' selected':'') + '>下午优先</option></select></div></div>' +\n        '<p class=\"small muted\">勾选固定不可排时段（例如教研会、调休，系统绝对不排课）：</p>' +\n        '<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>节次</th>' + days.map(d => '<th>' + d.label + '</th>').join('') + '</tr></thead><tbody>' +\n        tPeriods.map(p => '<tr><td>' + esc(p.name) + '</td>' + days.map(d => {\n          const k = d.day + '-' + p.id;\n          const checked = (tr.blockedSlots || []).includes(k) ? ' checked' : '';\n          return '<td style=\"text-align:center\"><input type=\"checkbox\" name=\"blockedSlots\" value=\"' + k + '\"' + checked + '></td>';\n        }).join('') + '</tr>').join('') +\n        '</tbody></table></div><button type=\"submit\" class=\"btn btn-primary btn-sm\" style=\"margin-top:10px\">保存教师时间规则</button></form>' : '') +\n      '</section>' +\n      '<section class=\"panel panel-pad\" style=\"margin-top:16px\"><h3>7. 教师组固定无课时间（教研活动 / 集体会议）</h3>' +\n      '<p class=\"small muted\">按教研组/部门批量预留活动时段，智能排课与手动调课自动避让。</p>' +\n      '<form id=\"sched-teacher-group-form\" style=\"margin-bottom:14px\"><div class=\"form-grid\">' +\n      '<div class=\"field\"><label>教师组名称 *</label><input name=\"name\" placeholder=\"如 语文教研组 / 行政组\" required></div>' +\n      '<div class=\"field\"><label>勾选组成员（支持一人多组）</label><div style=\"display:flex;flex-wrap:wrap;gap:8px;padding:8px;border:1px solid var(--border);border-radius:8px\">' +\n      (teachers.length ? teachers.map(t => '<label style=\"font-size:12px;display:flex;align-items:center;gap:4px\"><input type=\"checkbox\" name=\"teacherIds\" value=\"' + esc(t.id) + '\"><span>' + esc(t.name) + '</span></label>').join('') : '<span class=\"tiny muted\">暂无教师</span>') +\n      '</div></div></div><button type=\"submit\" class=\"btn btn-soft btn-sm\">+ 创建教师组</button></form>' +\n      '<div class=\"row wrap\" style=\"gap:6px;margin-bottom:14px\">' + (scope.teacherGroups || []).map(g => '<span class=\"pill blue\">' + esc(g.name) + ' (' + (g.teacherIds?.length || 0) + '人) <button type=\"button\" data-sched-action=\"del-tgroup\" data-id=\"' + esc(g.id) + '\" style=\"border:0;background:none;color:inherit;cursor:pointer\">×</button></span>').join('') + '</div>' +\n      ((scope.teacherGroups || []).length ? '<form id=\"sched-group-block-form\"><div class=\"form-grid\">' +\n        '<div class=\"field\"><label>目标教师组 *</label><select name=\"groupId\" required>' + scope.teacherGroups.map(g => '<option value=\"' + esc(g.id) + '\">' + esc(g.name) + '</option>').join('') + '</select></div>' +\n        '<div class=\"field\"><label>周期</label><select name=\"cycle\"><option value=\"weekly\">每周</option><option value=\"odd\">单周</option><option value=\"even\">双周</option><option value=\"custom\">指定周次</option></select></div>' +\n        '<div class=\"field\"><label>星期</label><select name=\"day\">' + days.map(dx => '<option value=\"' + dx.day + '\">' + dx.label + '</option>').join('') + '</select></div>' +\n        '<div class=\"field\"><label>活动类型</label><select name=\"activityType\"><option value=\"教研活动\">教研活动</option><option value=\"集体会议\">集体会议</option><option value=\"部门培训\">部门培训</option><option value=\"行政例会\">行政例会</option></select></div>' +\n        '<div class=\"field\"><label>自定义名称/标签</label><input name=\"label\" placeholder=\"如 语文组教研\"></div>' +\n        '<div class=\"field\"><label>背景色 / 图标</label><div class=\"row\"><input name=\"color\" type=\"color\" value=\"#fef3c7\" style=\"width:52px;padding:2px\"><input name=\"icon\" value=\"🔔\" maxlength=\"4\" style=\"width:60px\"></div></div></div>' +\n        '<div class=\"field\"><label>选择节次（可多选）*</label><div class=\"row wrap\" style=\"gap:10px\">' + tPeriods.map(tp => '<label style=\"font-size:13px;display:flex;align-items:center;gap:4px\"><input type=\"checkbox\" name=\"periodIds\" value=\"' + esc(tp.id) + '\"><span>' + esc(tp.name) + '</span></label>').join('') + '</div></div>' +\n        '<button type=\"submit\" class=\"btn btn-primary btn-sm\">+ 添加教师组固定无课时间</button></form>' : '') +\n      '<div style=\"margin-top:12px\">' + ((scope.groupBlocks || []).map(gb => {\n        const grp = (scope.teacherGroups || []).find(g => g.id === gb.groupId);\n        return '<div class=\"student-detail-row\"><span><span style=\"padding:2px 7px;border-radius:6px;background:' + esc(gb.color || '#fef3c7') + '\">' + esc(gb.icon || '🔔') + ' ' + esc(gb.label) + '</span> · <strong>' + esc(grp?.name || '') + '</strong> · 周' + gb.day + ' (' + (gb.periodIds || []).join(',') + ') · ' + (gb.active === false ? '已暂停' : '生效中') + '</span>' +\n          '<div class=\"row\"><button type=\"button\" class=\"btn btn-light btn-sm\" data-sched-action=\"toggle-gblock\" data-id=\"' + esc(gb.id) + '\">' + (gb.active === false ? '启用' : '暂停') + '</button><button type=\"button\" class=\"btn btn-danger btn-sm\" data-sched-action=\"del-gblock\" data-id=\"' + esc(gb.id) + '\">删除</button></div></div>';\n      }).join('') || '<p class=\"small muted\">尚未设置教师组固定无课时间。</p>') + '</div></section>';\n  }\n\n  function renderApprovalsTab(d) {\n    const scope = d.scope;\n    const teachers = d.teachers || [];\n    const reqs = scope.swapRequests || [];\n    const logs = scope.auditLogs || [];\n    const reqHtml = '<section class=\"panel panel-pad\" style=\"margin-bottom:20px\"><h3>调课 / 代课审批队列</h3>' +\n      (reqs.length ? reqs.map(r => {\n        const subTch = r.substituteTeacherId ? (teachers.find(t => t.id === r.substituteTeacherId)?.name || r.substituteTeacherId) : '';\n        return '<div class=\"student-detail-row\" style=\"align-items:flex-start\"><div><strong>' + esc(r.requesterName) + '</strong> · <span class=\"pill ' + (r.status==='approved'?'green':r.status==='rejected'?'gray':'blue') + '\">' + esc(r.status) + '</span>' +\n          '<div class=\"small muted\">原因：' + esc(r.reason) + (subTch ? ' · 拟代课：' + esc(subTch) : '') + (r.targetDay ? ' · 拟调至周' + r.targetDay + ' ' + esc(r.targetPeriodId) : '') + '</div></div>' +\n          (r.status === 'pending' ? '<div class=\"row\"><button type=\"button\" class=\"btn btn-primary btn-sm\" data-sched-action=\"approve-swap\" data-id=\"' + esc(r.id) + '\">同意并更新课表</button><button type=\"button\" class=\"btn btn-danger btn-sm\" data-sched-action=\"reject-swap\" data-id=\"' + esc(r.id) + '\">驳回</button></div>' : '<span class=\"tiny muted\">' + esc(r.reviewerName || '') + '</span>') +\n          '</div>';\n      }).join('') : '<p class=\"small muted\">暂无调课申请。</p>') + '</section>';\n    const logsHtml = '<section class=\"panel panel-pad\"><h3>课表变更留痕日志</h3>' +\n      (logs.length ? logs.slice(0, 40).map(l => '<div class=\"activity-row\"><span class=\"activity-dot\"></span><div><strong>' + esc(l.action) + '</strong> · ' + esc(l.actorName) + '<div class=\"small muted\">' + esc(l.detail) + (l.reason ? '（原因：' + esc(l.reason) + '）' : '') + '</div><small>' + fmtDate(l.createdAt) + '</small></div></div>').join('') : '<p class=\"small muted\">暂无变更记录。</p>') +\n      '</section>';\n    return reqHtml + logsHtml;\n  }\n\n\n  function dFallbackSubj(name) {\n    return (schedUI.data?.scope?.subjects || []).find(s => s.name === name);\n  }\n  function renderCombinedTab(d) {\n    const scope = d.scope;\n    const teachers = d.teachers || [];\n    const groupedIds = new Set((scope.combinedGroups || []).flatMap(g => g.planIds || []));\n    const availablePlans = (scope.plans || []).filter(pl => !groupedIds.has(pl.id));\n    const planCheckboxes = availablePlans.length\n      ? availablePlans.map(pl => {\n          const cls = scope.classes.find(c => c.id === pl.classId)?.name || '';\n          const sub = scope.subjects.find(s => s.id === pl.subjectId)?.name || '';\n          const tch = teachers.find(t => t.id === pl.teacherId)?.name || '';\n          return '<label style=\"display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:13px\"><input type=\"checkbox\" name=\"planIds\" value=\"' + esc(pl.id) + '\"><span><strong>' + esc(cls) + '</strong> · ' + esc(sub) + ' · ' + esc(tch) + ' (' + pl.weeklyHours + '节/周)</span></label>';\n        }).join('')\n      : '<p class=\"small muted\">暂无可合并的独立授课计划（请先在“基础数据”添加同一老师、同一科目的多班计划）。</p>';\n\n    const formHtml = '<section class=\"panel panel-pad\" style=\"margin-bottom:20px\"><h3>合班设置（同师同科多班合并）</h3>' +\n      '<p class=\"small muted\">勾选同一位教师、同一科目的多个班级计划，合并后自动排课与拖拽调课将跨班联动同步。</p>' +\n      '<form id=\"sched-combined-form\"><div style=\"display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin-bottom:12px\">' + planCheckboxes + '</div>' +\n      '<div class=\"form-grid\"><div class=\"field\"><label>合班简称 (可选)</label><input name=\"shortName\" placeholder=\"留空自动生成，如 高一1+2班 / 通用技术\"></div>' +\n      '<div class=\"field\"><label>指定合班教室 (如阶梯教室)</label><select name=\"roomId\"><option value=\"\">沿用原教室</option>' + scope.rooms.map(r => '<option value=\"' + esc(r.id) + '\">' + esc(r.name) + ' (' + r.capacity + '座)</option>').join('') + '</select></div></div>' +\n      '<button type=\"submit\" class=\"btn btn-primary btn-sm\">合并为合班课</button></form></section>';\n\n    const listHtml = '<section class=\"panel panel-pad\"><h3>已创建的合班课 (' + (scope.combinedGroups || []).length + ')</h3>' +\n      ((scope.combinedGroups || []).length ? scope.combinedGroups.map(g => {\n        const tch = teachers.find(t => t.id === g.teacherId)?.name || '';\n        const rm = scope.rooms.find(r => r.id === g.roomId)?.name || '';\n        return '<div class=\"student-detail-row\"><span><strong>' + esc(g.shortName) + '</strong> · ' + esc(tch) + (rm ? ' · ' + esc(rm) : '') + ' · ' + g.weeklyHours + '节/周</span>' +\n          '<button type=\"button\" class=\"btn btn-danger btn-sm\" data-sched-action=\"del-combined\" data-id=\"' + esc(g.id) + '\">解除合班</button></div>';\n      }).join('') : '<p class=\"small muted\">尚未设置合班课程。</p>') + '</section>';\n    return formHtml + listHtml;\n  }\n\n  function renderPlacementTab(d) {\n    const pl = d.scope.placement || { students: [], config: {}, result: null };\n    const cfg = pl.config || {};\n    const importHtml = '<section class=\"panel panel-pad\" style=\"margin-bottom:16px\"><div class=\"row-between wrap\"><div><h3>1. 导入新生名单</h3>' +\n      '<p class=\"small muted\">支持性别、总分/单科成绩、名次、特长标签，以及双胞胎绑定组与同名互斥组。当前已导入：<strong>' + (pl.students?.length || 0) + '</strong> 人</p></div>' +\n      '<a class=\"btn btn-light btn-sm\" href=\"/api/admin/schedule/placement/template\" download=\"student-placement-template.csv\">⬇ 下载新生分班模板 (.csv)</a></div>' +\n      '<form id=\"sched-placement-import-form\" style=\"margin-top:10px\"><div class=\"row wrap\"><input id=\"placement-csv-file\" type=\"file\" accept=\".csv,text/csv\" required><button type=\"submit\" class=\"btn btn-soft btn-sm\">导入新生名单</button></div></form></section>';\n\n    const configHtml = '<section class=\"panel panel-pad\" style=\"margin-bottom:16px\"><h3>2. 设置均衡分班规则</h3>' +\n      '<form id=\"sched-placement-preview-form\"><div class=\"form-grid\">' +\n      '<div class=\"field\"><label>目标班级数量</label><input name=\"classCount\" type=\"number\" min=\"1\" max=\"50\" value=\"' + n(cfg.classCount || 2) + '\" required></div>' +\n      '<div class=\"field\"><label>班级名称前缀</label><input name=\"classPrefix\" value=\"' + esc(cfg.classPrefix || '新生') + '\" required></div>' +\n      '<div class=\"field\"><label>成绩均衡模式</label><select name=\"mode\"><option value=\"total\"' + (cfg.mode==='total'?' selected':'') + '>总分均衡模式</option><option value=\"subjects\"' + (cfg.mode==='subjects'?' selected':'') + '>多科均衡(语数英+总分)</option><option value=\"rankBand\"' + (cfg.mode==='rankBand'?' selected':'') + '>名次分段均衡</option><option value=\"percentTier\"' + (cfg.mode==='percentTier'?' selected':'') + '>百分比分层均衡</option></select></div>' +\n      '<div class=\"field\"><label style=\"display:flex;align-items:center;gap:6px;margin-top:26px\"><input type=\"checkbox\" name=\"genderBalance\" value=\"1\"' + (cfg.genderBalance !== false ? ' checked' : '') + '> 启用男女生人数均衡</label></div></div>' +\n      '<button type=\"submit\" class=\"btn btn-primary btn-sm\">⚡ 生成分班预览</button></form></section>';\n\n    const res = pl.result;\n    const resHtml = res ? '<section class=\"panel panel-pad\"><div class=\"row-between wrap\" style=\"margin-bottom:12px\"><div><h3>3. 分班均衡度预览 (' + res.length + ' 个班)</h3><p class=\"small muted\">已自动执行双胞胎绑定、互斥拆分与特长分散均衡。</p></div>' +\n      '<div class=\"row wrap\"><button type=\"button\" class=\"btn btn-primary btn-sm\" data-sched-action=\"commit-placement\">✅ 确认生成正式行政班</button>' +\n      '<a class=\"btn btn-light btn-sm\" href=\"/api/admin/schedule/placement/export\" download=\"placement-roster.csv\">⬇ 导出分班名册 (.csv)</a></div></div>' +\n      '<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>班级</th><th>总人数</th><th>男 / 女</th><th>总分均分</th><th>语 / 数 / 英均分</th><th>特长分布</th></tr></thead><tbody>' +\n      res.map(c => '<tr><td><strong>' + esc(c.name) + '</strong></td><td>' + c.count + '</td><td>' + c.male + ' / ' + c.female + '</td><td>' + c.avgTotal + '</td><td>' + c.avgChinese + ' / ' + c.avgMath + ' / ' + c.avgEnglish + '</td><td>' + esc(Object.entries(c.tagCounts || {}).map(([k, v]) => k + ':' + v).join(' ') || '—') + '</td></tr>').join('') +\n      '</tbody></table></div></section>' : '';\n\n    return importHtml + configHtml + resHtml;\n  }\n\n  function renderExamsTab(d) {\n    const scope = d.scope;\n    const teachers = d.teachers || [];\n    const exams = scope.exams || [];\n    const activeExam = exams.find(ex => ex.id === schedUI.selectedExamId) || exams[0] || null;\n\n    const createHtml = '<section class=\"panel panel-pad\" style=\"margin-bottom:16px\"><h3>新建考试与监考规则</h3>' +\n      '<form id=\"sched-exam-create-form\"><div class=\"form-grid\">' +\n      '<div class=\"field\"><label>考试名称 *</label><input name=\"name\" placeholder=\"如 2026秋期中考试\" required></div>' +\n      '<div class=\"field\"><label>每场每考场监考人数</label><select name=\"proctorsPerRoom\"><option value=\"1\">1人</option><option value=\"2\">2人</option></select></div>' +\n      '<div class=\"field\"><label>所教班级规则</label><select name=\"taughtClass\"><option value=\"avoid\">尽量避免监考自己任教班级</option><option value=\"any\">无所谓</option><option value=\"prefer\">优先安排一位任教教师</option></select></div>' +\n      '<div class=\"field\"><label>所教课程规则</label><select name=\"taughtSubject\"><option value=\"avoid\">尽量避免监考自己所教科目</option><option value=\"any\">无所谓</option><option value=\"prefer\">优先安排一位任课教师</option></select></div></div>' +\n      '<div class=\"form-grid\"><div class=\"field\"><label>考试场次（每行一场：场次名,时间段,科目名称）</label><textarea name=\"slotsText\" rows=\"2\" placeholder=\"第一场 上午,08:30-10:30,数学&#10;第二场 下午,14:00-16:00,英语\" required>第一场 上午,08:30-10:30,语文&#10;第二场 下午,14:00-16:00,数学</textarea></div>' +\n      '<div class=\"field\"><label>考场列表（逗号分隔，可直接填班级或教室名）</label><textarea name=\"roomsText\" rows=\"2\" required>' + esc(scope.classes.length ? scope.classes.map(c => c.name).join(',') : '第1考场,第2考场') + '</textarea></div></div>' +\n      '<button type=\"submit\" class=\"btn btn-primary btn-sm\">+ 创建考试计划</button></form></section>';\n\n    let detailHtml = '';\n    const examPublished = activeExam?.status === 'published';\n    if (activeExam) {\n      const viewPills = '<div class=\"filter-pills\" style=\"margin:12px 0\">' +\n        [['plan', '📅 按考试计划'], ['teacher', '👨‍🏫 按监考教师'], ['room', '🏫 按考场']]\n          .map(([k, label]) => '<button type=\"button\" class=\"' + (schedUI.examView === k ? 'active' : '') + '\" data-sched-action=\"exam-view\" data-mode=\"' + k + '\">' + label + '</button>').join('') +\n        '</div>';\n      const asgs = activeExam.assignments || [];\n      let matrixHtml = '';\n      if (!asgs.length) {\n        matrixHtml = '<p class=\"small muted\">点击下方“自动排监考”即可按规则避开上课时间冲突并均衡分配监考老师。</p>';\n      } else if (schedUI.examView === 'plan') {\n        matrixHtml = '<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>场次 / 科目</th>' + activeExam.rooms.map(r => '<th>' + esc(r.name) + '</th>').join('') + '</tr></thead><tbody>' +\n          activeExam.slots.map(sl => '<tr><td><strong>' + esc(sl.dateLabel) + '</strong><br><span class=\"tiny muted\">' + esc(sl.startTime + '-' + sl.endTime + ' · ' + sl.subjectName) + '</span></td>' +\n            activeExam.rooms.map(rm => {\n              const a = asgs.find(x => x.slotId === sl.id && x.roomId === rm.id);\n              const names = (a?.teacherIds || []).map(tid => teachers.find(t => t.id === tid)?.name || tid).join('、') || '未分配';\n              return '<td><strong>' + esc(names) + '</strong>' + (a?.warnings?.length ? '<div class=\"tiny\" style=\"color:#b91c1c\">' + esc(a.warnings[0]) + '</div>' : '') + '</td>';\n            }).join('') + '</tr>').join('') +\n          '</tbody></table></div>';\n      } else if (schedUI.examView === 'teacher') {\n        const byTeacher = new Map();\n        for (const a of asgs) {\n          const sl = activeExam.slots.find(s => s.id === a.slotId);\n          const rm = activeExam.rooms.find(r => r.id === a.roomId);\n          for (const tid of (a.teacherIds || [])) {\n            if (!byTeacher.has(tid)) byTeacher.set(tid, []);\n            byTeacher.get(tid).push(`${sl?.dateLabel || ''} (${sl?.subjectName || ''}) → ${rm?.name || ''}`);\n          }\n        }\n        matrixHtml = [...byTeacher.entries()].map(([tid, list]) => {\n          const tName = teachers.find(t => t.id === tid)?.name || tid;\n          return '<div class=\"student-detail-row\"><span><strong>' + esc(tName) + '</strong> (共 ' + list.length + ' 场)</span><span class=\"small muted\">' + esc(list.join(' | ')) + '</span></div>';\n        }).join('');\n      } else {\n        matrixHtml = activeExam.rooms.map(rm => {\n          const list = asgs.filter(a => a.roomId === rm.id).map(a => {\n            const sl = activeExam.slots.find(s => s.id === a.slotId);\n            const names = (a.teacherIds || []).map(tid => teachers.find(t => t.id === tid)?.name || tid).join('、');\n            return `${sl?.dateLabel || ''} ${sl?.subjectName || ''}: ${names}`;\n          });\n          return '<div class=\"student-detail-row\"><span><strong>' + esc(rm.name) + '</strong></span><span class=\"small muted\">' + esc(list.join(' | ')) + '</span></div>';\n        }).join('');\n      }\n\n      detailHtml = '<section class=\"panel panel-pad\"><div class=\"row-between wrap\"><div><h3>' + esc(activeExam.name) + ' ' +\n        (examPublished ? '<span class=\"pill blue\">✅ 已同步师生</span>' : '<span class=\"pill gray\">草稿</span>') + '</h3>' +\n        '<p class=\"small muted\">规则：所教班级(' + esc(activeExam.rules?.taughtClass) + ') · 所教课程(' + esc(activeExam.rules?.taughtSubject) + ')</p></div>' +\n        '<div class=\"row wrap\">' +\n        (exams.length > 1 ? '<select data-sched-select=\"exam\">' + exams.map(ex => '<option value=\"' + esc(ex.id) + '\"' + (ex.id === activeExam.id ? ' selected' : '') + '>' + esc(ex.name) + '</option>').join('') + '</select>' : '') +\n        (examPublished\n          ? '<button type=\"button\" class=\"btn btn-light btn-sm\" data-sched-action=\"unpublish-exam\" data-id=\"' + esc(activeExam.id) + '\">↩ 撤回同步</button>'\n          : (asgs.length ? '<button type=\"button\" class=\"btn btn-primary btn-sm\" data-sched-action=\"publish-exam\" data-id=\"' + esc(activeExam.id) + '\">确认并同步师生</button>' : '')) +\n        '<button type=\"button\" class=\"btn btn-primary btn-sm\" data-sched-action=\"auto-proctor\" data-id=\"' + esc(activeExam.id) + '\">⚡ 自动排监考</button>' +\n        '<a class=\"btn btn-light btn-sm\" href=\"/api/admin/schedule/exams/' + encodeURIComponent(activeExam.id) + '/export\" download=\"exam-proctoring.csv\">⬇ 导出监考表 (.csv)</a>' +\n        '<button type=\"button\" class=\"btn btn-light btn-sm\" onclick=\"window.print()\">🖨 打印</button>' +\n        '<button type=\"button\" class=\"btn btn-danger btn-sm\" data-sched-action=\"del-exam\" data-id=\"' + esc(activeExam.id) + '\">删除</button>' +\n        '</div></div>' + viewPills + matrixHtml + '</section>';\n    }\n    return createHtml + detailHtml;\n  }\n\nfunction renderRulesTab(d) {\n    const rules = d.rules || [];\n    const config = d.ruleConfig || {};\n    const labels = { time: '⏰ 时间类冲突', resource: '🏫 资源类冲突', rule: '📋 教学规则与需求', special: '⚠️ 特殊安排', check: '✅ 检查清单' };\n    const order = ['time', 'resource', 'rule', 'special', 'check'];\n    const counts = {};\n    for (const c of (d.conflicts || [])) {\n      for (const item of [...(c.hard || []), ...(c.warnings || [])]) {\n        if (item.rule) counts[item.rule] = (counts[item.rule] || 0) + 1;\n      }\n    }\n    const severityLabel = { hard: '硬性', warning: '提醒', soft: '偏好', info: '清单' };\n    const sections = order.map(cat => {\n      const list = rules.filter(r => r.category === cat);\n      if (!list.length) return '';\n      const rows = list.map(r => {\n        const cfg = config[r.key] || {};\n        const enabled = cfg.enabled !== false && r.enabled !== false;\n        const paramKeys = Object.keys(r.params || {});\n        const paramsHtml = paramKeys.map(k => {\n          const val = cfg.params && cfg.params[k] !== undefined ? cfg.params[k] : r.params[k];\n          const num = typeof r.params[k] === 'number';\n          return '<label class=\"tiny muted\" style=\"display:inline-flex;align-items:center;gap:4px;margin-right:10px\">' + esc(k) +\n            '<input class=\"input-xs\" style=\"width:96px\" type=\"' + (num ? 'number' : 'text') + '\" name=\"param_' + esc(r.key) + '_' + esc(k) + '\" value=\"' + esc(String(val)) + '\"></label>';\n        }).join('');\n        const hit = counts[r.key];\n        return '<tr style=\"' + (enabled ? '' : 'opacity:.55') + '\">' +\n          '<td><label style=\"display:flex;align-items:center;gap:8px\"><input type=\"checkbox\" name=\"rule_' + esc(r.key) + '\" value=\"1\"' + (enabled ? ' checked' : '') + '> <strong>' + esc(r.name) + '</strong></label>' +\n          '<div class=\"tiny muted\" style=\"padding-left:24px\">' + esc(r.hint || '') + '</div></td>' +\n          '<td><code class=\"tiny\">' + esc(r.key) + '</code><div class=\"tiny muted\">' + esc(r.code) + '</div></td>' +\n          '<td>' + esc(severityLabel[r.severity] || r.severity) + '</td>' +\n          '<td>' + paramsHtml + '</td>' +\n          '<td>' + (hit ? '<span class=\"pill red\">' + hit + ' 项</span>' : '<span class=\"pill green\">正常</span>') + '</td>' +\n          '</tr>';\n      }).join('');\n      return '<section class=\"panel panel-pad\" style=\"margin-bottom:14px\"><h3>' + labels[cat] + '</h3>' +\n        '<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>排课条件（关键词）</th><th>关键词 / 代码</th><th>级别</th><th>参数</th><th>当前冲突</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';\n    }).join('');\n    return '<div class=\"page-head\"><div><div class=\"eyebrow\">RULE KEYWORDS</div><h1>排课规则关键词</h1>' +\n      '<p>把排课要求作为可开关的条件；智能排课与冲突检测会按这里启用的关键词执行。</p></div></div>' +\n      '<section class=\"panel panel-pad\" style=\"margin-bottom:14px\"><div style=\"display:flex;gap:8px;flex-wrap:wrap\">' +\n      '<button type=\"button\" class=\"btn btn-light btn-sm\" data-sched-action=\"rule-preset\" data-preset=\"all\">全部启用</button>' +\n      '<button type=\"button\" class=\"btn btn-light btn-sm\" data-sched-action=\"rule-preset\" data-preset=\"hard\">仅硬性冲突</button>' +\n      '<button type=\"button\" class=\"btn btn-light btn-sm\" data-sched-action=\"rule-preset\" data-preset=\"school\">中小学标准</button>' +\n      '<span class=\"tiny muted\" style=\"align-self:center\">一句话顺序：先锁固定时间 → 再排专用/连堂 → 老师班级不撞车 → 场地设备不重复 → 文理分布均衡 → 课时总量不超标</span>' +\n      '</div></section>' +\n      '<form id=\"sched-rules-form\">' + sections +\n      '<div style=\"display:flex;gap:8px;align-items:center\"><button type=\"submit\" class=\"btn btn-primary\">💾 保存排课条件</button>' +\n      '<span class=\"small muted\">关闭某条关键词后，智能排课和冲突报告都会跳过该项。</span></div></form>';\n  }\n    function renderAuditTab(d) {\n    const audit = d.audit || { teachers: [], classes: [], rooms: [] };\n    const section = (title, rows) => '<section class=\"panel panel-pad\" style=\"margin-bottom:14px\"><h3>' + title + '</h3>' +\n      (rows.length ? '<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>对象</th><th>节数</th><th>时间分布</th></tr></thead><tbody>' +\n        rows.map(r => '<tr><td><strong>' + esc(r.name || r.id) + '</strong></td><td>' + r.count + '</td><td class=\"tiny muted\">' + esc((r.slots || []).join(' · ')) + '</td></tr>').join('') +\n        '</tbody></table></div>' : '<p class=\"small muted\">暂无排课记录。</p>') + '</section>';\n    return '<div class=\"page-head\"><div><div class=\"eyebrow\">THREE-TABLE AUDIT</div><h1>三表对照自查</h1><p>按教师、班级、教室三张表交叉核对当前排课，配合冲突报告使用。</p></div></div>' +\n      section('教师时间表', audit.teachers || []) + section('班级时间表', audit.classes || []) + section('教室时间表', audit.rooms || []);\n  }\n  function renderAdminScheduleWorkspace() {\n    if (!schedUI.data && !schedUI.error) {\n      loadAdminSchedule();\n      return '<section class=\"panel panel-pad\">正在加载智能排课工作台…</section>';\n    }\n    if (schedUI.error) {\n      return '<section class=\"panel panel-pad\"><p class=\"form-error\">' + esc(schedUI.error) + '</p><button class=\"btn btn-soft\" data-sched-action=\"reload\">重试</button></section>';\n    }\n    const d = schedUI.data;\n    const pendingCount = (d.scope.swapRequests || []).filter(r => r.status === 'pending').length;\n    const subNav = '<div class=\"tabs\" style=\"margin-bottom:16px\">' +\n      '<button type=\"button\" class=\"tab ' + (schedUI.subTab === 'timetable' ? 'active' : '') + '\" data-sched-action=\"subtab\" data-tab=\"timetable\">📅 智能排课与课表视图</button>' +\n      '<button type=\"button\" class=\"tab ' + (schedUI.subTab === 'basedata' ? 'active' : '') + '\" data-sched-action=\"subtab\" data-tab=\"basedata\">⚙ 基础数据与约束设置</button>' +\n      '<button type=\"button\" class=\"tab ' + (schedUI.subTab === 'combined' ? 'active' : '') + '\" data-sched-action=\"subtab\" data-tab=\"combined\">🔗 合班设置</button>' +\n      '<button type=\"button\" class=\"tab ' + (schedUI.subTab === 'placement' ? 'active' : '') + '\" data-sched-action=\"subtab\" data-tab=\"placement\">🎓 智能分班</button>' +\n      '<button type=\"button\" class=\"tab ' + (schedUI.subTab === 'exams' ? 'active' : '') + '\" data-sched-action=\"subtab\" data-tab=\"exams\">📝 监考安排</button>' +\n      '<button type=\"button\" class=\"tab ' + (schedUI.subTab === 'rules' ? 'active' : '') + '\" data-sched-action=\"subtab\" data-tab=\"rules\">🔑 排课规则关键词</button>' +\n      '<button type=\"button\" class=\"tab ' + (schedUI.subTab === 'audit' ? 'active' : '') + '\" data-sched-action=\"subtab\" data-tab=\"audit\">✅ 三表对照自查</button>' +\n      '<button type=\"button\" class=\"tab ' + (schedUI.subTab === 'approvals' ? 'active' : '') + '\" data-sched-action=\"subtab\" data-tab=\"approvals\">📝 调课审批与日志' + (pendingCount ? ' (' + pendingCount + ')' : '') + '</button>' +\n      '</div>';\n    const content = schedUI.subTab === 'timetable' ? renderTimetableTab(d) : schedUI.subTab === 'basedata' ? renderBaseDataTab(d) : schedUI.subTab === 'combined' ? renderCombinedTab(d) : schedUI.subTab === 'placement' ? renderPlacementTab(d) : schedUI.subTab === 'exams' ? renderExamsTab(d) : schedUI.subTab === 'rules' ? renderRulesTab(d) : schedUI.subTab === 'audit' ? renderAuditTab(d) : renderApprovalsTab(d);\n    return subNav + content + renderAddSlotModal(d) + renderConflictModal();\n  }\n\n  function renderAddSlotModal(d) {\n    if (!schedUI.addSlot) return '';\n    const scope = d.scope;\n    const teachers = d.teachers || [];\n    return '<div class=\"modal-backdrop\" data-sched-action=\"close-add-slot\"><div class=\"modal\"><div class=\"modal-head\"><h2>手动排课 (周' + schedUI.addSlot.day + ' ' + esc(schedUI.addSlot.periodId) + ')</h2>' +\n      '<button class=\"icon-btn\" type=\"button\" data-sched-action=\"close-add-slot\">✕</button></div>' +\n      '<form id=\"sched-manual-entry-form\"><div class=\"modal-body\">' +\n      '<div class=\"field\"><label>班级</label><select name=\"classId\" required>' + scope.classes.map(c => '<option value=\"' + esc(c.id) + '\"' + (schedUI.selectedClassId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></div>' +\n      '<div class=\"field\"><label>科目</label><select name=\"subjectId\" required>' + scope.subjects.map(s => '<option value=\"' + esc(s.id) + '\">' + esc(s.name) + '</option>').join('') + '</select></div>' +\n      '<div class=\"field\"><label>教师</label><select name=\"teacherId\" required>' + teachers.map(t => '<option value=\"' + esc(t.id) + '\">' + esc(t.name) + '</option>').join('') + '</select></div>' +\n      '<div class=\"field\"><label>教室 (可选)</label><select name=\"roomId\"><option value=\"\">不指定</option>' + scope.rooms.map(r => '<option value=\"' + esc(r.id) + '\">' + esc(r.name) + '</option>').join('') + '</select></div>' +\n      '<label style=\"display:flex;align-items:center;gap:6px\"><input type=\"checkbox\" name=\"locked\" value=\"1\"> 锁定此课程（不被自动排课覆盖）</label>' +\n      '</div><div class=\"modal-actions\"><button type=\"button\" class=\"btn btn-light\" data-sched-action=\"close-add-slot\">取消</button><button type=\"submit\" class=\"btn btn-primary\">确认排课</button></div></form></div></div>';\n  }\n\n  function renderConflictModal() {\n    if (!schedUI.conflictModal) return '';\n    const m = schedUI.conflictModal;\n    return '<div class=\"modal-backdrop\" data-sched-action=\"close-conflict\"><div class=\"modal\"><div class=\"modal-head\"><h2 style=\"color:#dc2626\">⚠ 检测到排课硬冲突</h2>' +\n      '<button class=\"icon-btn\" type=\"button\" data-sched-action=\"close-conflict\">✕</button></div><div class=\"modal-body\">' +\n      (m.hard || []).map(h => '<p class=\"form-error\">🔴 ' + esc(h.message) + '</p>').join('') +\n      (m.alternatives?.length ? '<p class=\"small\"><strong>推荐可用空白时段：</strong></p><div class=\"row wrap\" style=\"gap:6px;margin-bottom:12px\">' +\n        m.alternatives.map(a => '<button type=\"button\" class=\"btn btn-soft btn-sm\" data-sched-action=\"use-alt\" data-day=\"' + a.day + '\" data-period=\"' + esc(a.periodId) + '\">周' + a.day + ' ' + esc(a.periodName) + '</button>').join('') + '</div>' : '') +\n      '<form id=\"sched-force-form\"><div class=\"field\"><label>超级管理员强制放行原因（留痕记录）</label><input name=\"overrideReason\" placeholder=\"如：临时合班/紧急活动调课\" required></div>' +\n      '<button type=\"submit\" class=\"btn btn-danger btn-sm\">强制放行并记录日志</button></form>' +\n      '</div></div></div>';\n  }\n\n  function renderExamSchedule(d) {\n    const exams = d?.exams || [];\n    if (!exams.length) {\n      return '<section class=\"panel panel-pad\" style=\"margin-top:20px\"><div class=\"row-between wrap\"><h3>考试与监考安排</h3><span class=\"pill gray\">暂无</span></div>' +\n        '<p class=\"small muted\">管理员发布考试安排后，相关场次、考场和监考教师会自动同步到这里。</p></section>';\n    }\n    return '<section class=\"panel panel-pad\" style=\"margin-top:20px\"><div class=\"row-between wrap\"><h3>考试与监考安排</h3><span class=\"pill blue\">' + exams.length + ' 场</span></div>' +\n      exams.map(ex => {\n        const bySlot = {};\n        for (const a of (ex.assignments || [])) {\n          if (!bySlot[a.slotId]) bySlot[a.slotId] = [];\n          bySlot[a.slotId].push(a);\n        }\n        const rows = (ex.slots || []).map(sl => {\n          const list = bySlot[sl.id] || [];\n          if (!list.length) return '';\n          const cells = list.map(a => {\n            const room = (ex.rooms || []).find(r => r.id === a.roomId);\n            return '<div class=\"student-detail-row\"><span><strong>' + esc(room?.name || '考场') + '</strong></span><span class=\"small muted\">' + esc(a.teacherNames || '监考待定') + '</span></div>';\n          }).join('');\n          return '<tr><td><strong>' + esc(sl.dateLabel || '') + '</strong><br><span class=\"tiny muted\">' + esc((sl.startTime || '') + '–' + (sl.endTime || '')) + ' · ' + esc(sl.subjectName || '') + '</span></td><td>' + cells + '</td></tr>';\n        }).filter(Boolean).join('');\n        return '<div style=\"margin-top:14px\"><strong>' + esc(ex.name) + '</strong><div class=\"tiny muted\">发布于 ' + fmtDate(ex.publishedAt) + '</div>' +\n          '<div class=\"table-wrap\" style=\"margin-top:8px\"><table class=\"data-table\"><thead><tr><th>场次 / 时间</th><th>考场与监考</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';\n      }).join('') + '</section>';\n  }\n  function renderMyTimetablePage() {\n    if (!schedUI.myData && !schedUI.myLoading) {\n      loadMyTimetable();\n      return '<section class=\"panel panel-pad\">正在加载个人课表…</section>';\n    }\n    const d = schedUI.myData;\n    if (!d || !d.published) {\n      return '<div class=\"page-head\"><div><div class=\"eyebrow\">MY TIMETABLE</div><h1>个人课表</h1><p>查看学校正式发布的每周课程安排。</p></div></div>' +\n        em('学校尚未发布正式课表', '管理员发布课表后，您的每周课表将自动同步到这里。') + renderExamSchedule(d || {});\n    }\n    const days = getDayNames(d.daysPerWeek);\n    const periods = d.periods || [];\n    const isTeacher = state.user?.role === 'teacher';\n    const header = '<tr><th style=\"width:110px\">节次 / 时间</th>' + days.map(x => '<th>' + x.label + '</th>').join('') + '</tr>';\n    const rows = periods.map(p => {\n      if (p.isBreak) return '<tr style=\"background:#f3f4f6\"><td colspan=\"' + (days.length + 1) + '\" style=\"text-align:center;color:#6b7280;font-size:12px;padding:6px\"><strong>' + esc(p.name) + '</strong> (' + esc(p.startTime) + '–' + esc(p.endTime) + ')</td></tr>';\n      const cells = days.map(day => {\n        const list = d.entries.filter(e => Number(e.day) === day.day && e.periodId === p.id);\n        const acts = isTeacher ? (d.groupActivities || []).filter(gb => Number(gb.day) === day.day && (gb.periodIds || []).includes(p.id)) : [];\n        const actHtml = acts.map(gb => '<div style=\"padding:5px 7px;border-radius:6px;background:' + esc(gb.color || '#fef3c7') + ';font-size:12px;margin-bottom:4px\"><strong>' + esc(gb.icon || '🔔') + ' ' + esc(gb.label || gb.activityType) + '</strong><div class=\"tiny muted\">' + esc(gb.groupName || '') + '</div></div>').join('');\n        return '<td>' + ((list.length || actHtml) ? actHtml + list.map(e => '<div style=\"padding:6px;border-radius:8px;border:1px solid var(--border);background:#fff\"><strong>' + esc(e.subjectName) + '</strong><div class=\"tiny muted\">' + esc(e.className) + (e.teacherName ? ' · ' + esc(e.teacherName) : '') + (e.roomName ? ' · ' + esc(e.roomName) : '') + '</div></div>').join('') : '<span class=\"tiny muted\">' + (isTeacher ? '无课' : '—') + '</span>') + '</td>';\n      }).join('');\n      return '<tr><td><strong>' + esc(p.name) + '</strong><br><span class=\"tiny muted\">' + esc(p.startTime) + '–' + esc(p.endTime) + '</span></td>' + cells + '</tr>';\n    }).join('');\n    const reqForm = isTeacher && d.entries.length ? '<section class=\"panel panel-pad\" style=\"margin-top:20px\"><h3>提交调课 / 代课申请</h3><form id=\"teacher-swap-req-form\"><div class=\"form-grid\">' +\n      '<div class=\"field\"><label>选择要调整的课程</label><select name=\"entryId\" required>' + d.entries.map(e => '<option value=\"' + esc(e.id) + '\">周' + e.day + ' ' + esc(e.periodId) + ' · ' + esc(e.subjectName) + ' (' + esc(e.className) + ')</option>').join('') + '</select></div>' +\n      '<div class=\"field\"><label>拟代课教师 (可选)</label><select name=\"substituteTeacherId\"><option value=\"\">不换教师</option>' + (d.schoolTeachers || []).map(t => '<option value=\"' + esc(t.id) + '\">' + esc(t.name) + '</option>').join('') + '</select></div>' +\n      '<div class=\"field\"><label>拟调至星期 (可选)</label><select name=\"targetDay\"><option value=\"\">不变</option>' + days.map(x => '<option value=\"' + x.day + '\">' + x.label + '</option>').join('') + '</select></div>' +\n      '<div class=\"field\"><label>拟调至节次 (可选)</label><select name=\"targetPeriodId\"><option value=\"\">不变</option>' + periods.filter(p => !p.isBreak).map(p => '<option value=\"' + esc(p.id) + '\">' + esc(p.name) + '</option>').join('') + '</select></div></div>' +\n      '<div class=\"field\"><label>申请原因 *</label><input name=\"reason\" placeholder=\"如：外出教研/病假调课\" required></div>' +\n      '<button type=\"submit\" class=\"btn btn-primary btn-sm\">提交管理员审批</button></form>' +\n      ((d.swapRequests || []).length ? '<div style=\"margin-top:14px\"><strong>我的申请记录</strong>' + d.swapRequests.map(r => '<div class=\"student-detail-row\"><span>' + esc(r.reason) + '</span><span class=\"pill blue\">' + esc(r.status) + '</span></div>').join('') + '</div>' : '') +\n      '</section>' : '';\n    return '<div class=\"page-head\"><div><div class=\"eyebrow\">PUBLISHED TIMETABLE</div><h1>我的个人课表</h1><p>发布时间：' + fmtDate(d.publishedAt) + '</p></div><button type=\"button\" class=\"btn btn-light\" onclick=\"window.print()\">🖨 打印课表</button></div>' +\n      '<section class=\"panel panel-pad\"><div class=\"table-wrap\"><table class=\"data-table\"><thead>' + header + '</thead><tbody>' + rows + '</tbody></table></div></section>' + reqForm + renderExamSchedule(d);\n  }\n\n  window.renderAdminScheduleWorkspace = renderAdminScheduleWorkspace;\n  window.renderMyTimetablePage = renderMyTimetablePage;\n\n  // Event delegation for scheduling actions\n  document.addEventListener('click', event => {\n    const btn = event.target.closest('[data-sched-action]');\n    if (!btn) return;\n    const act = btn.dataset.schedAction;\n    if ((act === 'close-add-slot' || act === 'close-conflict') && btn.classList.contains('modal-backdrop') && event.target !== btn) return;\n    event.preventDefault();\n    if (act === 'reload') { schedUI.error = ''; schedUI.data = null; render(); return; }\n    if (act === 'subtab') { schedUI.subTab = btn.dataset.tab; render(); return; }\n    if (act === 'rule-preset') {\n      const preset = btn.dataset.preset;\n      run(async () => {\n        const rules = schedUI.data?.rules || [];\n        const config = {};\n        for (const r of rules) {\n          let enabled = true;\n          if (preset === 'hard') enabled = r.severity === 'hard';\n          if (preset === 'school') enabled = !['TRAVEL_BUFFER', 'TEACHER_PREFERENCE', 'RESERVE_SLACK'].includes(r.key);\n          config[r.key] = { enabled, params: { ...(r.params || {}) } };\n        }\n        await api('/api/admin/schedule/rules', { method: 'PUT', body: JSON.stringify({ config }) });\n        await refreshAdminSchedule();\n        showToast('排课条件已切换为预设方案');\n      }, '保存失败: ');\n      return;\n    }\n\n    if (act === 'view-mode') { schedUI.viewMode = btn.dataset.mode; render(); return; }\n    if (act === 'toggle-options') { schedUI.optionsOpen = !schedUI.optionsOpen; render(); return; }\n    if (act === 'export-wysiwyg' && schedUI.data) { exportWysiwygExcel(schedUI.data); showToast('已按当前界面显示模式导出 Excel 课表'); return; }\n    if (act === 'open-add-slot') { schedUI.addSlot = { day: Number(btn.dataset.day), periodId: btn.dataset.period }; render(); return; }\n    if (act === 'close-add-slot') { schedUI.addSlot = null; render(); return; }\n    if (act === 'close-conflict') { schedUI.conflictModal = null; render(); return; }\n    if (act === 'use-alt' && schedUI.conflictModal?.candidate) {\n      const c = { ...schedUI.conflictModal.candidate, day: Number(btn.dataset.day), periodId: btn.dataset.period };\n      run(async () => {\n        await api('/api/admin/schedule/entries', { method: 'POST', body: JSON.stringify(c) });\n        schedUI.conflictModal = null; schedUI.addSlot = null;\n        await refreshAdminSchedule(); showToast('已按推荐时段排课');\n      }, '排课失败: ');\n      return;\n    }\n    if (act === 'auto-schedule-selected') {\n      const cf = schedUI.courseFilter || { courseIds: [] };\n      const options = (schedUI.data?.courseOptions || []).filter(c =>\n        (!cf.department || c.ownerDepartment === cf.department) && (!cf.grade || c.academicYear === cf.grade) && (!cf.major || (c.targetMajors || []).includes(cf.major)));\n      const ids = cf.courseIds.length ? cf.courseIds : options.map(c => c.id);\n      if (!ids.length) { showToast('请先选择学院/年级/专业下的课程', true); return; }\n      run(async () => {\n        const res = await api('/api/admin/schedule/auto', { method: 'POST', body: JSON.stringify({ courseIds: ids }) });\n        await refreshAdminSchedule();\n        showToast('已按所选 ' + ids.length + ' 门课程排课：成功 ' + res.placedCount + ' 节，未排 ' + (res.unplaced?.length || 0) + ' 项');\n      }, '排课失败: ');\n      return;\n    }\n    if (act === 'auto-schedule') {\n      run(async () => {\n        const res = await api('/api/admin/schedule/auto', { method: 'POST', body: JSON.stringify({}) });\n        await refreshAdminSchedule();\n        showToast('智能排课完成：已排 ' + res.placedCount + ' 节，未排 ' + (res.unplaced?.length || 0) + ' 项');\n      }, '排课失败: ');\n      return;\n    }\n    if (act === 'publish-schedule') {\n      run(async () => {\n        await api('/api/admin/schedule/publish', { method: 'POST', body: JSON.stringify({}) });\n        await refreshAdminSchedule();\n        showToast('正式课表已发布并同步给全校师生！');\n      }, '发布失败: ');\n      return;\n    }\n    if (act === 'archive-schedule') {\n      const name = prompt('请输入存档名称（例如：2026秋第1版）', '课表存档 ' + new Date().toLocaleDateString());\n      if (!name) return;\n      run(async () => {\n        await api('/api/admin/schedule/archive', { method: 'POST', body: JSON.stringify({ name }) });\n        await refreshAdminSchedule(); showToast('课表已存档');\n      }, '存档失败: ');\n      return;\n    }\n    if (act === 'toggle-lock') {\n      run(async () => { await api('/api/admin/schedule/entries/' + encodeURIComponent(btn.dataset.id) + '/lock', { method: 'PATCH', body: JSON.stringify({}) }); await refreshAdminSchedule(); }, '');\n      return;\n    }\n    if (act === 'delete-entry') {\n      run(async () => { await api('/api/admin/schedule/entries/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }); await refreshAdminSchedule(); showToast('已删除'); }, '');\n      return;\n    }\n    if (act === 'del-grade' || act === 'del-class' || act === 'del-subject' || act === 'del-room' || act === 'del-plan') {\n      const map = { 'del-grade': 'grades', 'del-class': 'classes', 'del-subject': 'subjects', 'del-room': 'rooms', 'del-plan': 'plans' };\n      run(async () => { await api('/api/admin/schedule/' + map[act] + '/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }); await refreshAdminSchedule(); }, '删除失败: ');\n      return;\n    }\n    if (act === 'exam-view') { schedUI.examView = btn.dataset.mode; render(); return; }\n    if (act === 'del-combined') {\n      run(async () => { await api('/api/admin/schedule/combined/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }); await refreshAdminSchedule(); showToast('已解除合班'); }, '操作失败: ');\n      return;\n    }\n    if (act === 'commit-placement') {\n      run(async () => { const res = await api('/api/admin/schedule/placement/commit', { method: 'POST', body: JSON.stringify({}) }); await refreshAdminSchedule(); showToast('已正式生成 ' + res.classes.length + ' 个行政班'); }, '生成失败: ');\n      return;\n    }\n    if (act === 'auto-proctor') {\n      run(async () => { await api('/api/admin/schedule/exams/' + encodeURIComponent(btn.dataset.id) + '/auto', { method: 'POST', body: JSON.stringify({}) }); await refreshAdminSchedule(); showToast('已完成自动排监考'); }, '排监考失败: ');\n      return;\n    }\n    if (act === 'publish-exam') {\n      const exam = (schedUI.data?.scope?.exams || []).find(ex => ex.id === btn.dataset.id);\n      if (!exam || !confirm('确认考试安排完整无误，并同步给相关教师和学生？')) return;\n      run(async () => {\n        await api('/api/admin/schedule/exams/' + encodeURIComponent(exam.id) + '/publish', { method: 'POST', body: '{}' });\n        await refreshAdminSchedule();\n        showToast('考试安排已同步给相关教师和学生');\n      }, '同步失败: ');\n      return;\n    }\n    if (act === 'unpublish-exam') {\n      const exam = (schedUI.data?.scope?.exams || []).find(ex => ex.id === btn.dataset.id);\n      if (!exam || !confirm('撤回后教师和学生端将不再显示该考试安排，确认撤回？')) return;\n      run(async () => {\n        await api('/api/admin/schedule/exams/' + encodeURIComponent(exam.id) + '/unpublish', { method: 'POST', body: '{}' });\n        await refreshAdminSchedule();\n        showToast('已撤回考试安排同步');\n      }, '撤回失败: ');\n      return;\n    }\n    if (act === 'del-tgroup') {\n      run(async () => { await api('/api/admin/schedule/teacher-groups/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }); await refreshAdminSchedule(); showToast('已删除教师组'); }, '操作失败: ');\n      return;\n    }\n    if (act === 'toggle-gblock') {\n      run(async () => { await api('/api/admin/schedule/group-blocks/' + encodeURIComponent(btn.dataset.id) + '/toggle', { method: 'PATCH', body: JSON.stringify({}) }); await refreshAdminSchedule(); showToast('状态已更新'); }, '操作失败: ');\n      return;\n    }\n    if (act === 'del-gblock') {\n      run(async () => { await api('/api/admin/schedule/group-blocks/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }); await refreshAdminSchedule(); showToast('已删除'); }, '操作失败: ');\n      return;\n    }\n    if (act === 'del-exam') {\n      run(async () => { await api('/api/admin/schedule/exams/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }); schedUI.selectedExamId = ''; await refreshAdminSchedule(); showToast('已删除考试计划'); }, '删除失败: ');\n      return;\n    }\n    if (act === 'approve-swap' || act === 'reject-swap') {\n      const decision = act === 'approve-swap' ? 'approve' : 'reject';\n      run(async () => { await api('/api/admin/schedule/requests/' + encodeURIComponent(btn.dataset.id) + '/review', { method: 'POST', body: JSON.stringify({ decision }) }); await refreshAdminSchedule(); showToast(decision === 'approve' ? '已同意并自动更新课表' : '已驳回'); }, '审批失败: ');\n    }\n  });\n\n  document.addEventListener('change', event => {\n    const courseFilterKey = event.target.dataset?.schedCourseFilter;\n    if (courseFilterKey) {\n      if (courseFilterKey === 'courseIds') schedUI.courseFilter.courseIds = [...event.target.selectedOptions].map(o => o.value);\n      else {\n        schedUI.courseFilter[courseFilterKey] = event.target.value;\n        schedUI.courseFilter.courseIds = [];\n      }\n      render();\n      return;\n    }\n    const prefKey = event.target.dataset?.schedPref;\n    if (prefKey) {\n      schedUI.prefs[prefKey] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;\n      savePrefs(schedUI.prefs);\n      render();\n      return;\n    }\n    const sel = event.target.dataset?.schedSelect;\n    if (!sel) return;\n    if (sel === 'class') schedUI.selectedClassId = event.target.value;\n    else if (sel === 'teacher') schedUI.selectedTeacherId = event.target.value;\n    else if (sel === 'room') schedUI.selectedRoomId = event.target.value;\n    else if (sel === 'rule-teacher') schedUI.selectedRuleTeacherId = event.target.value;\n    else if (sel === 'exam') schedUI.selectedExamId = event.target.value;\n    render();\n  });\n\n  // Drag & drop swap\n  document.addEventListener('dragstart', event => {\n    const card = event.target.closest('[data-sched-entry]');\n    if (card) schedUI.dragEntryId = card.dataset.schedEntry;\n  });\n  document.addEventListener('dragover', event => {\n    if (event.target.closest('[data-sched-drop]')) event.preventDefault();\n  });\n  document.addEventListener('drop', event => {\n    const targetCard = event.target.closest('[data-sched-entry]');\n    if (!schedUI.dragEntryId || !targetCard) return;\n    const entryAId = schedUI.dragEntryId;\n    const entryBId = targetCard.dataset.schedEntry;\n    schedUI.dragEntryId = null;\n    if (entryAId === entryBId) return;\n    event.preventDefault();\n    run(async () => {\n      await api('/api/admin/schedule/swap', { method: 'POST', body: JSON.stringify({ entryAId, entryBId }) });\n      await refreshAdminSchedule();\n      showToast('已互换两节课程');\n    }, '无法互换: ');\n  });\n\n  document.addEventListener('submit', event => {\n    const form = event.target;\n    const ids = ['sched-settings-form', 'sched-grade-form', 'sched-class-form', 'sched-subject-form', 'sched-room-form', 'sched-plan-form', 'sched-teacher-rule-form', 'sched-manual-entry-form', 'sched-force-form', 'teacher-swap-req-form', 'sched-combined-form', 'sched-placement-import-form', 'sched-placement-preview-form', 'sched-exam-create-form', 'sched-teacher-group-form', 'sched-group-block-form', 'sched-rules-form'];\n    if (!ids.includes(form.id)) return;\n    event.preventDefault();\n    event.stopImmediatePropagation();\n    const values = Object.fromEntries(new FormData(form));\n    if (form.id === 'sched-rules-form') {\n      const config = {};\n      for (const rule of (schedUI.data?.rules || [])) {\n        const params = {};\n        for (const [k, def] of Object.entries(rule.params || {})) {\n          const el = form.querySelector('[name=\"param_' + rule.key + '_' + k + '\"]');\n          if (el) params[k] = typeof def === 'number' ? Number(el.value) : el.value;\n        }\n        config[rule.key] = { enabled: Boolean(form.querySelector('[name=\"rule_' + rule.key + '\"]')?.checked), params };\n      }\n      run(async () => { await api('/api/admin/schedule/rules', { method: 'PUT', body: JSON.stringify({ config }) }); await refreshAdminSchedule(); showToast('排课条件已保存，智能排课将按新规则执行'); }, '保存失败: ');\n    } else if (form.id === 'sched-settings-form') {\n      run(async () => { await api('/api/admin/schedule/settings', { method: 'PUT', body: JSON.stringify(values) }); await refreshAdminSchedule(); showToast('作息设置已保存'); }, '保存失败: ');\n    } else if (form.id === 'sched-grade-form') {\n      run(async () => { await api('/api/admin/schedule/grades', { method: 'POST', body: JSON.stringify(values) }); await refreshAdminSchedule(); showToast('年级已添加'); }, '添加失败: ');\n    } else if (form.id === 'sched-class-form') {\n      run(async () => { const res = await api('/api/admin/schedule/classes', { method: 'POST', body: JSON.stringify(values) }); schedUI.selectedClassId = res.cls.id; await refreshAdminSchedule(); showToast('班级已添加'); }, '添加失败: ');\n    } else if (form.id === 'sched-subject-form') {\n      run(async () => { await api('/api/admin/schedule/subjects', { method: 'POST', body: JSON.stringify(values) }); await refreshAdminSchedule(); showToast('科目已添加'); }, '添加失败: ');\n    } else if (form.id === 'sched-room-form') {\n      run(async () => { const res = await api('/api/admin/schedule/rooms', { method: 'POST', body: JSON.stringify(values) }); schedUI.selectedRoomId = res.room.id; await refreshAdminSchedule(); showToast('教室已添加'); }, '添加失败: ');\n    } else if (form.id === 'sched-plan-form') {\n      run(async () => { await api('/api/admin/schedule/plans', { method: 'POST', body: JSON.stringify({ ...values, fixed: form.querySelector('input[name=\"fixed\"]')?.checked }) }); await refreshAdminSchedule(); showToast('授课计划已添加'); }, '添加失败: ');\n    } else if (form.id === 'sched-teacher-rule-form') {\n      const blockedSlots = [...form.querySelectorAll('input[name=\"blockedSlots\"]:checked')].map(x => x.value);\n      run(async () => { await api('/api/admin/schedule/teacher-rules/' + encodeURIComponent(schedUI.selectedRuleTeacherId), { method: 'PUT', body: JSON.stringify({ ...values, blockedSlots }) }); await refreshAdminSchedule(); showToast('教师规则已保存'); }, '保存失败: ');\n    } else if (form.id === 'sched-manual-entry-form') {\n      const candidate = { ...values, day: schedUI.addSlot.day, periodId: schedUI.addSlot.periodId, locked: form.querySelector('input[name=\"locked\"]')?.checked };\n      run(async () => {\n        const res = await fetch('/api/admin/schedule/entries', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(candidate) });\n        const data = await res.json();\n        if (res.status === 409) { schedUI.conflictModal = { ...data, candidate }; render(); return; }\n        if (!res.ok) throw new Error(data.error || '排课失败');\n        schedUI.addSlot = null; await refreshAdminSchedule(); showToast('排课成功');\n      }, '');\n    } else if (form.id === 'sched-force-form') {\n      const candidate = { ...schedUI.conflictModal.candidate, forceOverride: true, overrideReason: values.overrideReason };\n      run(async () => {\n        await api('/api/admin/schedule/entries', { method: 'POST', body: JSON.stringify(candidate) });\n        schedUI.conflictModal = null; schedUI.addSlot = null; await refreshAdminSchedule(); showToast('已强制放行并记录日志');\n      }, '操作失败: ');\n    } else if (form.id === 'sched-combined-form') {\n      const planIds = [...form.querySelectorAll('input[name=\"planIds\"]:checked')].map(x => x.value);\n      run(async () => { await api('/api/admin/schedule/combined', { method: 'POST', body: JSON.stringify({ ...values, planIds }) }); await refreshAdminSchedule(); showToast('合班创建成功'); }, '合班失败: ');\n    } else if (form.id === 'sched-placement-import-form') {\n      const file = form.querySelector('input[type=\"file\"]')?.files?.[0];\n      if (!file) return;\n      run(async () => { const csv = await file.text(); const res = await api('/api/admin/schedule/placement/import', { method: 'POST', body: JSON.stringify({ csv }) }); await refreshAdminSchedule(); showToast('已导入 ' + res.count + ' 名新生'); }, '导入失败: ');\n    } else if (form.id === 'sched-placement-preview-form') {\n      const genderBalance = Boolean(form.querySelector('input[name=\"genderBalance\"]')?.checked);\n      run(async () => { await api('/api/admin/schedule/placement/preview', { method: 'POST', body: JSON.stringify({ ...values, genderBalance }) }); await refreshAdminSchedule(); showToast('分班预览已生成'); }, '分班失败: ');\n    } else if (form.id === 'sched-exam-create-form') {\n      const slots = String(values.slotsText || '').split(/\\r?\\n/).map(s => s.trim()).filter(Boolean).map(line => {\n        const [dateLabel, timeRange, subjectName] = line.split(',').map(x => x.trim());\n        const [startTime, endTime] = (timeRange || '08:30-10:30').split('-');\n        const subj = dFallbackSubj(subjectName);\n        return { dateLabel: dateLabel || '第一场', startTime: startTime || '08:30', endTime: endTime || '10:30', subjectName: subjectName || '', subjectId: subj?.id || '' };\n      });\n      const rooms = String(values.roomsText || '').split(/[,，\\n]/).map(x => x.trim()).filter(Boolean).map(name => {\n        const cls = (schedUI.data?.scope?.classes || []).find(c => c.name === name);\n        return { name, classId: cls?.id || '' };\n      });\n      run(async () => {\n        const res = await api('/api/admin/schedule/exams', { method: 'POST', body: JSON.stringify({ name: values.name, slots, rooms, rules: { taughtClass: values.taughtClass, taughtSubject: values.taughtSubject, proctorsPerRoom: Number(values.proctorsPerRoom || 1) } }) });\n        schedUI.selectedExamId = res.exam.id;\n        await refreshAdminSchedule();\n        showToast('考试计划已创建');\n      }, '创建失败: ');\n    } else if (form.id === 'sched-teacher-group-form') {\n      const teacherIds = [...form.querySelectorAll('input[name=\"teacherIds\"]:checked')].map(x => x.value);\n      run(async () => { await api('/api/admin/schedule/teacher-groups', { method: 'POST', body: JSON.stringify({ name: values.name, teacherIds }) }); await refreshAdminSchedule(); showToast('教师组已创建'); }, '创建失败: ');\n    } else if (form.id === 'sched-group-block-form') {\n      const periodIds = [...form.querySelectorAll('input[name=\"periodIds\"]:checked')].map(x => x.value);\n      if (!periodIds.length) { showToast('请至少选择一个节次', true); return; }\n      run(async () => { await api('/api/admin/schedule/group-blocks', { method: 'POST', body: JSON.stringify({ ...values, periodIds }) }); await refreshAdminSchedule(); showToast('已设置教师组固定无课时间'); }, '设置失败: ');\n    } else if (form.id === 'teacher-swap-req-form') {\n      run(async () => {\n        await api('/api/teacher/schedule/requests', { method: 'POST', body: JSON.stringify(values) });\n        await loadMyTimetable(); showToast('调课申请已提交管理员审批');\n      }, '提交失败: ');\n    }\n  }, true);\n})();\n";
const V2_JS_FULL = "// Additional course enrollment, assignment, media, and gradebook views.\n(() => {\n  const gradeNames = { usual: 'Coursework', quiz: 'In-class Assessments', midterm: 'Midterm Exam', final: 'Final Exam' };\n  const gradeKeys = Object.keys(gradeNames);\n  state.lessonFolders = [];\n  state.lessonResourcesFor = null;\n  state.lessonFoldersLoading = false;\n  const baseShell = shell;\n  shell = function(content) {\n    const teacher = state.user?.role === 'teacher';\n    const extra = teacher ? navItem('grades', 'Grade Management', '◈') : navItem('enrollcode', 'Course Enrollment', '⊕') + navItem('grades', 'My Grades', '◈');\n    const title = state.page === 'grades' ? (teacher ? 'Grade Management' : 'My Grades') : state.page === 'gradebook' ? 'Gradebook' : state.page === 'enrollcode' ? 'Course Enrollment' : '';\n    let html = baseShell(content).replace('</nav>', extra + '</nav>');\n    if (title) html = html.replace('<b>Learning Space</b>', '<b>' + esc(title) + '</b>');\n    return html;\n  };\n  const baseCourseCard = courseCard;\n  courseCard = function(course, teacher) {\n    const html = baseCourseCard(course, teacher);\n    return teacher ? html : html.replace('Open for Enrollment', 'Enroll with Code');\n  };\n  const baseTeacherManage = teacherManage;\n  teacherManage = function() {\n    let index = 0;\n    return baseTeacherManage().replace(/<span class=\"meta\">/g, () => {\n      const course = state.courses.filter(c => (c.teacherId === state.user.id || (Array.isArray(c.teacherIds) && c.teacherIds.includes(state.user.id))))[index++];\n      return '<span class=\"meta\">Enrollment Code ' + esc(course?.enrollmentCode || 'Not generated') + ' · ';\n    });\n  };\n  const baseModal = modal;\n  modal = function() {\n    if (state.modal?.type === 'assignment') return assignmentModal();\n    if (state.modal?.type === 'submission-grade') return submissionGradeModal();\n    let html = baseModal();\n    if (state.modal?.type === 'course') {\n      const field = '<div class=\"field\"><label for=\"course-code\">Course Enrollment Code</label><input id=\"course-code\" name=\"enrollmentCode\" value=\"' + esc(state.modal.course?.enrollmentCode || '') + '\" maxlength=\"20\" pattern=\"[A-Za-z0-9-]{4,20}\" placeholder=\"Leave blank to generate automatically\"><div class=\"field-hint\">4–20 letters, numbers, or hyphens. Students need this code to join the course.</div></div>';\n      return html.replace('<div class=\"field\"><label for=\"course-color\">', field + '<div class=\"field\"><label for=\"course-color\">');\n    }\n    if (state.modal?.type === 'lesson') {\n      const field = '<div class=\"field\"><label for=\"lesson-upload\">Upload Video (Optional)</label><input id=\"lesson-upload\" type=\"file\" accept=\"video/mp4,video/webm,video/ogg\"><div class=\"field-hint\">MP4, WebM, or OGG. The video uploads when you save the lesson.</div></div>';\n      const boundary = '</div><div class=\"modal-actions\">';\n      const offset = html.lastIndexOf(boundary);\n      return offset < 0 ? html : html.slice(0, offset) + field + html.slice(offset);\n    }\n    return html;\n  };\n  const baseRender = render;\n  render = function() {\n    if (!state.user) return baseRender();\n    if (state.page === 'enrollcode') { app.innerHTML = shell(enrollPage()); return; }\n    if (state.page === 'grades') { app.innerHTML = shell(gradesPage()); return; }\n    if (state.page === 'gradebook' && ['teacher','admin'].includes(state.user.role)) { app.innerHTML = shell(gradebookPage()); return; }\n    return baseRender();\n  };\n  const baseNavigate = navigate;\n  navigate = async function(page) {\n    if (page === 'grades' && state.user?.role === 'student') {\n      const data = await api('/api/student/grades');\n      state.myGrades = data.courses || [];\n    }\n    await baseNavigate(page);\n  };\n  function enrollPage() {\n    const enrolled = state.courses.filter(c => c.enrolled);\n    return `<div class=\"page-head\"><div><div class=\"eyebrow\">COURSE ENROLLMENT</div><h1>Course Enrollment</h1><p>Enter the code provided by your teacher to join a course.</p></div></div><section class=\"panel panel-pad code-panel\"><div class=\"code-icon\">⌘</div><div><h2>Join a Course with a Code</h2><p class=\"muted small\">Each course has a unique code set by its teacher. Ask your teacher for the code.</p><form id=\"enroll-code-form\" class=\"code-form\"><label for=\"enroll-code\">Course Code</label><div class=\"row\"><input id=\"enroll-code\" name=\"code\" placeholder=\"e.g., ABCD-2026\" minlength=\"4\" maxlength=\"20\" autocomplete=\"off\" required><button class=\"btn btn-primary\" type=\"submit\">Join Course →</button></div></form></div></section><div class=\"section-head\"><div><h2>Enrolled Courses</h2><p>View or withdraw from your courses at any time</p></div><span class=\"pill blue\">${enrolled.length} courses</span></div>${enrolled.length ? enrolled.map(c => `<div class=\"panel enroll-row\"><div><strong>${esc(c.title)}</strong><p class=\"small muted\">${esc(c.teacherName || 'Teacher')} · Progress: ${percent(c.progress)}</p></div><div class=\"row wrap\"><button class=\"btn btn-soft btn-sm\" data-action=\"open-course\" data-id=\"${esc(c.id)}\">Open Course</button><button class=\"btn btn-danger btn-sm\" data-action=\"unenroll\" data-id=\"${esc(c.id)}\">Withdraw</button></div></div>`).join('') : em('No enrolled courses yet', 'Enter a course code to start learning.')}`;\n  }\n  function gradesPage() {\n    if (['teacher','admin'].includes(state.user.role)) {\n      const courses = state.courses.filter(c => (c.teacherId === state.user.id || (Array.isArray(c.teacherIds) && c.teacherIds.includes(state.user.id))));\n      return `<div class=\"page-head\"><div><div class=\"eyebrow\">GRADE MANAGEMENT</div><h1>Grade Management</h1><p>Set grade weights and record coursework, in-class assessment, midterm, and final exam scores for each course.</p></div></div>${courses.length ? courses.map(c => `<div class=\"panel enroll-row\"><div><strong>${esc(c.title)}</strong><p class=\"small muted\">${n(c.studentCount)} students · Enrollment Code ${esc(c.enrollmentCode || 'Not generated')}</p></div><button class=\"btn btn-primary btn-sm\" data-action=\"open-gradebook\" data-id=\"${esc(c.id)}\">Open Gradebook →</button></div>`).join('') : em('No courses yet','Create a course to set up its gradebook.')}`;\n    }\n    return `<div class=\"page-head\"><div><div class=\"eyebrow\">MY GRADES</div><h1>My Grades</h1><p>View your assessment results, class rank, and overall grade for each enrolled course.</p></div></div>${state.myGrades.length ? state.myGrades.map(g => studentGradeCard(g)).join('') : em('No grades yet','Grades will appear here after you join a course and complete assessments.')}`;\n  }\n  function gradebookPage() {\n    const c = state.selectedCourse;\n    if (!c) return '<div class=\"page-head\"><div><div class=\"eyebrow\">GRADE MANAGEMENT</div><h1>Gradebook</h1></div></div>' + em('No course selected', 'Open Grade Management and choose a course.');\n    const pub = state.gradebook?.publication || { status: 'draft', publishedAt: null };\n    const published = pub.status === 'published';\n    const badge = published\n      ? '<span class=\"pill green\">✅ 已发布给学生</span>'\n      : '<span class=\"pill red\">⏳ 待发布 · 学生暂不可见</span>';\n    const courseId = encodeURIComponent(c.id);\n    return '<div class=\"page-head\"><div><div class=\"eyebrow\">GRADE MANAGEMENT</div><h1>' + esc(c.title) + ' · Gradebook</h1><p>' + badge + ' <span class=\"small muted\">' +\n      (published ? '发布时间：' + esc(fmtDate(pub.publishedAt)) + ' · 已同步 ' + n(pub.studentCount) + ' 名学生' : '导入或修改成绩后，请点击“一键发布”同步给学生。') +\n      '</span></p></div>' +\n      '<div class=\"row wrap\"><button type=\"button\" class=\"btn btn-light\" data-action=\"navigate\" data-page=\"grades\">← Back to Grade Management</button>' +\n      '<a class=\"btn btn-light btn-sm\" href=\"/api/courses/' + courseId + '/gradebook/import/template?format=csv\">⬇ 下载成绩模板</a>' +\n      '<label class=\"btn btn-soft btn-sm\" style=\"cursor:pointer\">⬆ 一键导入成绩<input id=\"gradebook-import-file\" type=\"file\" accept=\".csv,.xlsx,.tsv,.tab,.txt,.json\" style=\"display:none\"></label>' +\n      '<button type=\"button\" class=\"btn btn-primary btn-sm\" data-action=\"publish-gradebook\">🚀 一键发布给学生</button>' +\n      (published ? '<button type=\"button\" class=\"btn btn-light btn-sm\" data-action=\"unpublish-gradebook\">↩ 撤回发布</button>' : '') +\n      '<button type=\"button\" class=\"btn btn-soft\" data-action=\"export-gradebook\">⬇ Export Gradebook (.csv)</button></div></div>' + gradebookPanel();\n  }\n  function studentGradeCard(g) {\n    const classSize = Number.isInteger(g.classSize) ? g.classSize : 0;\n    const rank = Number.isInteger(g.rank) ? g.rank : null;\n    const assignments = Array.isArray(g.assignments) ? g.assignments : [];\n    const quizzes = Array.isArray(g.quizAttempts) ? g.quizAttempts : [];\n    const assignmentRows = assignments.map(a => `<div class=\"assessment-row\"><div><strong>${esc(a.title || 'Assignment')}</strong><small>Submitted ${fmtDate(a.submittedAt)}</small>${a.feedback ? `<small>Teacher feedback: ${esc(a.feedback)}</small>` : ''}</div><b>${a.score == null ? 'Awaiting grade' : `${esc(a.score)} / ${esc(a.maxScore)}`}</b></div>`).join('');\n    const quizRows = quizzes.map(a => `<div class=\"assessment-row\"><div><strong>${esc(a.title || 'Course Quiz')}</strong><small>Submitted ${fmtDate(a.submittedAt)}</small></div><b>${esc(a.score)} / ${esc(a.total)} · ${percent(a.percent)}</b></div>`).join('');\n    return `<section class=\"panel panel-pad grade-card\"><div class=\"row-between\"><div><h2>${esc(g.courseTitle)}</h2><p class=\"muted small\">Your course results and assessment history</p></div><div class=\"grade-summary\">${g.status === 'draft' ? '<span class=\"pill red\">成绩待发布</span>' : ''}<span class=\"grade-total\">${g.total == null ? 'Not published' : esc(Number(g.total).toFixed(1))}</span><span class=\"grade-rank\">Rank ${rank == null ? '—' : esc(rank)}/${esc(classSize)}</span></div></div><div class=\"grade-grid\">${gradeKeys.map(key => `<div class=\"grade-cell\"><span>${gradeNames[key]}</span><strong>${g.scores?.[key] == null ? 'Awaiting score' : esc(g.scores[key])}</strong>${['assignments','quiz'].includes(g.sources?.[key]) ? '<em>Calculated automatically</em>' : ''}</div>`).join('')}</div><div class=\"assessment-history\"><div><h3>Assignment Scores</h3>${assignmentRows || '<p class=\"small muted\">No submitted assignments yet.</p>'}</div><div><h3>Quiz Attempts</h3>${quizRows || '<p class=\"small muted\">No quiz attempts yet.</p>'}</div></div></section>`;\n  }\n  const baseLoadTabData = loadTabData;\n  loadTabData = async function(tab) {\n    await baseLoadTabData(tab);\n    if (!state.selectedCourse) return;\n    const courseId = encodeURIComponent(state.selectedCourse.id);\n    if (tab === 'assignments') {\n      if (state.user.role === 'student' && !state.selectedCourse.enrolled) return;\n      const data = await api('/api/courses/' + courseId + '/assignments');\n      state.assignments = data.assignments || [];\n      state.submissions = [];\n      state.assignmentSelected = null;\n    }\n    if (tab === 'gradebook' && ['teacher','admin'].includes(state.user.role)) {\n      state.gradebook = await api('/api/courses/' + courseId + '/gradebook');\n    }\n  };\n  const baseDetailPage = detailPage;\n  detailPage = function() {\n    if (!state.selectedCourse) return baseDetailPage();\n    const teacher = ['teacher','admin'].includes(state.user.role);\n    let html = baseDetailPage();\n    const tab = state.activeTab;\n    const tabButtons = `<button class=\"tab ${tab === 'assignments' ? 'active' : ''}\" data-action=\"detail-tab\" data-tab=\"assignments\">Assignment Management</button>${teacher ? `<button class=\"tab ${tab === 'gradebook' ? 'active' : ''}\" data-action=\"detail-tab\" data-tab=\"gradebook\">Gradebook</button>` : ''}`;\n    html = html.replace(/(<button class=\"tab [^\"]*\" data-action=\"detail-tab\" data-tab=\"discussion\">[^<]*<\\/button>)/, '$1' + tabButtons);\n    const selectedPanel = tab === 'assignments' ? assignmentPanel() : tab === 'gradebook' && teacher ? gradebookPanel() : null;\n    if (selectedPanel !== null) {\n      const contentEnd = '</section><aside class=\"panel panel-pad teacher-side\">';\n      const idx = html.indexOf('<div class=\"tabs\">');\n      const end = html.indexOf(contentEnd, idx);\n      if (idx >= 0 && end >= 0) {\n        const tabsEnd = html.indexOf('</div>', idx) + '</div>'.length;\n        html = html.slice(0, tabsEnd) + selectedPanel + html.slice(end);\n      }\n    }\n    if (teacher) {\n      const code = '<div class=\"course-code\"><span>Enrollment code for this course</span><strong>' + esc(state.selectedCourse.enrollmentCode || 'Not generated') + '</strong><small>Share this code only with students in this course</small></div>';\n      html = html.replace('<div class=\"detail-layout\">', code + '<div class=\"detail-layout\">');\n    } else {\n      html = html.replaceAll('data-action=\"enroll\"', 'data-action=\"show-enroll-code\"');\n      if (state.selectedCourse.enrolled) html = html.replace('<div class=\"detail-layout\">', '<div class=\"row\" style=\"justify-content:flex-end;margin:10px 0 16px\"><button class=\"btn btn-danger btn-sm\" data-action=\"unenroll\" data-id=\"' + esc(state.selectedCourse.id) + '\">Withdraw from This Course</button></div><div class=\"detail-layout\">');\n    }\n    return html;\n  };\n  const baseLessonView = lessonView;\n  lessonView = function(course, lesson) {\n    let html = baseLessonView(course, lesson);\n    if (lesson?.videoFileUrl) {\n      const video = `<div class=\"video-uploaded\"><p class=\"small muted\">Teacher-uploaded video</p><video class=\"lesson-video\" controls preload=\"metadata\" src=\"${esc(lesson.videoFileUrl)}\">Your browser does not support video playback.</video></div>`;\n      html = html.replace('</section>', video + '</section>');\n    }\n    if (lesson && (['teacher','admin'].includes(state.user.role) || course.enrolled)) {\n      html = html.replace('</section>', lessonResourcesPanel(lesson.id) + '</section>');\n    }\n    return html;\n  };\n  function lessonResourcesPanel(lessonId) {\n    const teacher = ['teacher','admin'].includes(state.user.role);\n    const loaded = state.lessonResourcesFor === lessonId;\n    const folders = loaded ? state.lessonFolders : [];\n    const list = state.lessonFoldersLoading || !loaded\n      ? '<p class=\"small muted\">Loading lesson files…</p>'\n      : folders.length ? folders.map(folder => lessonFolderCard(lessonId, folder, teacher)).join('')\n        : '<p class=\"small muted\">No lesson folders have been added yet.</p>';\n    const create = teacher ? `<form id=\"lesson-folder-form\" class=\"lesson-folder-create\" data-lesson-id=\"${esc(lessonId)}\"><label for=\"lesson-folder-name\">New Folder</label><div class=\"row\"><input id=\"lesson-folder-name\" name=\"name\" maxlength=\"80\" placeholder=\"e.g., Week 1 Reading\" required><button class=\"btn btn-soft btn-sm\" type=\"submit\">Create Folder</button></div></form>` : '';\n    return `<div class=\"lesson-resources\"><div class=\"row-between\"><div><h3>Lesson Files</h3><p class=\"small muted\">${teacher ? 'Organize course materials in folders for your students.' : 'Download a complete folder as a ZIP file.'}</p></div></div>${create}<div class=\"lesson-folder-list\">${list}</div></div>`;\n  }\n  function lessonFolderCard(lessonId, folder, teacher) {\n    const folderId = esc(folder.id);\n    const fileRows = (folder.files || []).map(file => `<div class=\"lesson-file-row\"><span>▤ ${esc(file.name)}</span><span class=\"small muted\">${formatBytes(file.size)}</span>${teacher ? `<button type=\"button\" class=\"btn btn-danger btn-sm\" data-action=\"delete-lesson-file\" data-lesson-id=\"${esc(lessonId)}\" data-folder-id=\"${folderId}\" data-id=\"${esc(file.id)}\" aria-label=\"Delete ${esc(file.name)}\">Delete</button>` : ''}</div>`).join('');\n    const download = (folder.files || []).length ? `<a class=\"btn btn-soft btn-sm\" href=\"/api/lessons/${encodeURIComponent(lessonId)}/folders/${encodeURIComponent(folder.id)}/download\" download>Download Folder (.zip)</a>` : '';\n    const controls = teacher ? `<button type=\"button\" class=\"btn btn-danger btn-sm\" data-action=\"delete-lesson-folder\" data-lesson-id=\"${esc(lessonId)}\" data-id=\"${folderId}\">Delete Folder</button>` : '';\n    const upload = teacher ? `<form class=\"lesson-file-upload\" data-lesson-id=\"${esc(lessonId)}\" data-folder-id=\"${folderId}\"><label for=\"lesson-files-${folderId}\">Add Files</label><div class=\"row\"><input id=\"lesson-files-${folderId}\" type=\"file\" name=\"files\" multiple accept=\".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.webp,.zip\" required><button class=\"btn btn-primary btn-sm\" type=\"submit\">Upload Files</button></div><p class=\"tiny muted\">Up to 15 MB per file, maximum 50 files in a folder.</p></form>` : '';\n    return `<section class=\"lesson-folder-card\"><div class=\"row-between\"><div><strong>▣ ${esc(folder.name)}</strong><p class=\"tiny muted\">${(folder.files || []).length} files</p></div><div class=\"row wrap\">${download}${controls}</div></div>${fileRows || '<p class=\"small muted\">This folder is empty.</p>'}${upload}</section>`;\n  }\n  function formatBytes(bytes) {\n    const size = Number(bytes) || 0;\n    return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;\n  }\n  async function refreshLessonFolders(lessonId) {\n    const data = await api('/api/lessons/' + encodeURIComponent(lessonId) + '/folders');\n    if (state.activeLesson !== lessonId) return;\n    state.lessonFolders = Array.isArray(data.folders) ? data.folders : [];\n    state.lessonResourcesFor = lessonId;\n    state.lessonFoldersLoading = false;\n    render();\n  }\n  function gradebookPanel() {\n    const book = state.gradebook || { weights: {}, students: [] };\n    return `<div class=\"row-between\"><div><h3>${esc(state.selectedCourse.title)} · Gradebook</h3><p class=\"small muted\">Grade weights must add up to 100%. The overall grade stays unpublished until all weighted scores are entered.</p></div></div><form id=\"weights-form\" class=\"weights-form\"><div class=\"grade-grid\">${gradeKeys.map(key => `<label class=\"grade-cell\">${gradeNames[key]}<input type=\"number\" name=\"${key}\" min=\"0\" max=\"100\" step=\"0.1\" value=\"${esc(book.weights?.[key] ?? 0)}\" required><small>%</small></label>`).join('')}</div><button type=\"submit\" class=\"btn btn-primary btn-sm\">Save Grade Weights</button></form><div class=\"section-head\"><div><h3>Student Scores</h3><p>Assessment and coursework scores can be calculated from quizzes and assignments, or overridden by the teacher.</p></div></div>${book.students?.length ? book.students.map(studentScoreRow).join('') : em('No students enrolled yet','Students will appear here after joining with the course code.')}`;\n  }\n  function studentScoreRow(s) {\n    return `<form class=\"grade-student-form panel\" data-user-id=\"${esc(s.userId)}\"><div class=\"row-between\"><div><strong>${esc(s.name)} · ${esc(s.studentId)}</strong><p class=\"small muted\">Assignment average ${s.assignmentAverage == null ? 'N/A' : esc(s.assignmentAverage)} · Best quiz score ${s.quizBest == null ? 'N/A' : esc(s.quizBest)}</p></div><span class=\"grade-total\">${s.total == null ? 'Not published' : esc(Number(s.total).toFixed(1))}</span></div><div class=\"grade-grid\">${gradeKeys.map(key => `<label class=\"grade-cell\">${gradeNames[key]}<input name=\"${key}\" type=\"number\" min=\"0\" max=\"100\" step=\"0.1\" value=\"${s.sources?.[key] === 'teacher' ? esc(s.scores?.[key]) : ''}\" placeholder=\"${s.scores?.[key] == null ? 'Not graded' : 'Auto: ' + esc(s.scores[key])}\">${['assignments','quiz'].includes(s.sources?.[key]) ? '<small>Calculated automatically; you can override it</small>' : ''}</label>`).join('')}</div><div class=\"row\" style=\"justify-content:flex-end\"><button class=\"btn btn-soft btn-sm\" type=\"submit\">Save Student Grades</button></div></form>`;\n  }\n  function assignmentPanel() {\n    const teacher = ['teacher','admin'].includes(state.user.role);\n    if (!teacher && !state.selectedCourse.enrolled) return em('Join the course to submit assignments', 'Enter the code from your teacher in Course Enrollment.', '<button class=\"btn btn-primary\" data-action=\"show-enroll-code\">Go to Course Enrollment →</button>');\n    const cards = state.assignments.map(a => assignmentCard(a, teacher)).join('');\n    return `<div class=\"row-between\" style=\"margin-bottom:18px\"><div><h3 style=\"margin:0\">${teacher ? 'Assignment Management' : 'Course Assignments'}</h3><p class=\"tiny muted\">${teacher ? 'Create assignments, track submissions, and grade student work' : 'Submit text or a file, and view teacher feedback and grades'}</p></div>${teacher ? '<button class=\"btn btn-soft btn-sm\" data-action=\"new-assignment\">＋ Create Assignment</button>' : ''}</div>${cards || em('No assignments yet', teacher ? 'Create an assignment to start collecting student work.' : 'Assignments will appear here when your teacher posts them.')}${teacher && state.assignmentSelected ? submissionsPanel() : ''}`;\n  }\n  function assignmentCard(a, teacher) {\n    const sub = a.submission;\n    const deadline = a.dueAt ? fmtDate(a.dueAt) : 'No due date';\n    const actions = teacher ? `<div class=\"row wrap\"><button class=\"btn btn-light btn-sm\" data-action=\"edit-assignment\" data-id=\"${esc(a.id)}\">Edit</button><button class=\"btn btn-danger btn-sm\" data-action=\"delete-assignment\" data-id=\"${esc(a.id)}\">Delete</button></div>` : '';\n    let below;\n    if (teacher) below = `<div class=\"row-between assignment-stats\"><span>Submitted: ${n(a.stats?.submitted)} / ${n(a.stats?.totalStudents)} · Graded: ${n(a.stats?.graded)}</span><button class=\"btn btn-soft btn-sm\" data-action=\"view-submissions\" data-id=\"${esc(a.id)}\">View Submissions and Grades →</button></div>`;\n    else {\n      const fileLink = sub?.fileUrl ? `<a class=\"file-link\" href=\"${esc(sub.fileUrl)}\" target=\"_blank\" rel=\"noopener\">View submitted file: ${esc(sub.fileName)}</a>` : '';\n      const status = sub ? `<p class=\"small\">Submitted on ${fmtDate(sub.submittedAt)} · ${sub.score == null ? 'Awaiting grading' : 'Score: ' + esc(sub.score) + ' / ' + esc(a.maxScore)}${sub.feedback ? '<br>Teacher feedback: ' + esc(sub.feedback) : ''}</p>${fileLink}` : '<p class=\"small muted\">Not submitted</p>';\n      below = `<div class=\"assignment-submission\">${status}<form class=\"assignment-submit-form\" data-assignment-id=\"${esc(a.id)}\"><label>Assignment Response (Optional)</label><textarea name=\"content\" maxlength=\"30000\" placeholder=\"Type your response or upload a file below\">${esc(sub?.content || '')}</textarea><label>Assignment File (Optional)</label><input type=\"file\" name=\"file\" accept=\".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg\"><button class=\"btn btn-primary btn-sm\" type=\"submit\">${sub ? 'Resubmit Assignment' : 'Submit Assignment'}</button></form></div>`;\n    }\n    return `<article class=\"assignment-card\"><div class=\"row-between\"><div><span class=\"pill blue\">Assignment · ${esc(a.maxScore)} points</span><h3>${esc(a.title)}</h3><p class=\"small muted\">${esc(a.instructions || 'No instructions have been added yet.')}</p><p class=\"tiny muted\">Due: ${esc(deadline)}</p></div>${actions}</div>${below}</article>`;\n  }\n  function submissionsPanel() {\n    const a = state.assignments.find(x => x.id === state.assignmentSelected);\n    if (!a) return '';\n    const rows = state.submissions.map(s => {\n      const file = s.fileUrl ? `<a class=\"file-link\" href=\"${esc(s.fileUrl)}\" target=\"_blank\" rel=\"noopener\">View assignment file: ${esc(s.fileName)} ↗</a>` : '';\n      return `<article class=\"submission-row\"><div><strong>${esc(s.studentName)} · ${esc(s.studentId)}</strong><p class=\"small muted\">${fmtDate(s.submittedAt)} · ${s.score == null ? 'Awaiting grading' : 'Score: ' + esc(s.score) + ' / ' + esc(a.maxScore)}</p><p class=\"small\">${esc(s.content || 'File submitted without a written response')}</p>${file}${s.feedback ? '<p class=\"small muted\">Teacher feedback: ' + esc(s.feedback) + '</p>' : ''}</div><button class=\"btn btn-soft btn-sm\" data-action=\"grade-submission\" data-id=\"${esc(s.id)}\">${s.score == null ? 'Grade Assignment' : 'Edit Grade'}</button></article>`;\n    }).join('');\n    return `<section class=\"panel panel-pad submissions-panel\"><div class=\"row-between\"><div><h3>${esc(a.title)} · Submission Summary</h3><p class=\"small muted\">Submitted: ${n(a.stats?.submitted)} / ${n(a.stats?.totalStudents)} · Graded: ${n(a.stats?.graded)}</p></div><button class=\"btn btn-light btn-sm\" data-action=\"hide-submissions\">Hide</button></div>${rows || em('No submissions yet','Student submissions will appear here for review and grading.')}</section>`;\n  }\n  function assignmentModal() {\n    const a = state.modal.assignment || {};\n    const date = a.dueAt ? new Date(a.dueAt) : null;\n    const localDue = date && !isNaN(date) ? new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16) : '';\n    return `<div class=\"modal-backdrop\" data-action=\"close-modal\"><div class=\"modal\" role=\"dialog\" aria-modal=\"true\"><div class=\"modal-head\"><h2>${a.id ? 'Edit Assignment' : 'Create Assignment'}</h2><button class=\"icon-btn\" data-action=\"close-modal\" aria-label=\"Close\">✕</button></div><form id=\"assignment-form\"><div class=\"modal-body\"><div class=\"field\"><label for=\"assignment-title\">Assignment Title *</label><input id=\"assignment-title\" name=\"title\" value=\"${esc(a.title)}\" maxlength=\"120\" required></div><div class=\"field\"><label for=\"assignment-instructions\">Instructions *</label><textarea id=\"assignment-instructions\" name=\"instructions\" rows=\"6\" required>${esc(a.instructions)}</textarea></div><div class=\"form-grid\"><div class=\"field\"><label for=\"assignment-due\">Due Date and Time</label><input id=\"assignment-due\" name=\"dueAt\" type=\"datetime-local\" value=\"${esc(localDue)}\"></div><div class=\"field\"><label for=\"assignment-max\">Maximum Score</label><input id=\"assignment-max\" name=\"maxScore\" type=\"number\" min=\"1\" max=\"1000\" step=\"0.1\" value=\"${esc(a.maxScore ?? 100)}\" required></div></div></div><div class=\"modal-actions\"><button class=\"btn btn-light\" type=\"button\" data-action=\"close-modal\">Cancel</button><button class=\"btn btn-primary\" type=\"submit\">Save Assignment</button></div></form></div></div>`;\n  }\n  function submissionGradeModal() {\n    const s = state.modal.submission;\n    const a = state.assignments.find(x => x.id === state.assignmentSelected);\n    return `<div class=\"modal-backdrop\" data-action=\"close-modal\"><div class=\"modal\" role=\"dialog\" aria-modal=\"true\"><div class=\"modal-head\"><h2>Grade ${esc(s.studentName)}'s assignment</h2><button class=\"icon-btn\" data-action=\"close-modal\" aria-label=\"Close\">✕</button></div><form id=\"submission-grade-form\"><div class=\"modal-body\"><p class=\"small muted\">${esc(a?.title)} · Maximum score: ${esc(a?.maxScore)}</p><div class=\"field\"><label>Score: *</label><input name=\"score\" type=\"number\" min=\"0\" max=\"${esc(a?.maxScore)}\" step=\"0.1\" value=\"${esc(s.score ?? '')}\" required></div><div class=\"field\"><label>Feedback</label><textarea name=\"feedback\" rows=\"5\" maxlength=\"2000\">${esc(s.feedback || '')}</textarea></div></div><div class=\"modal-actions\"><button class=\"btn btn-light\" type=\"button\" data-action=\"close-modal\">Cancel</button><button class=\"btn btn-primary\" type=\"submit\">Save Grade</button></div></form></div></div>`;\n  }\n  async function refreshAssignments() {\n    const data = await api('/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/assignments');\n    state.assignments = data.assignments || [];\n  }\n  async function refreshGradebook() {\n    state.gradebook = await api('/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/gradebook');\n  }\n  async function uploadFile(endpoint, file) {\n    const limit = endpoint.includes('/video') ? 80 * 1024 * 1024 : 15 * 1024 * 1024;\n    if (file.size > limit) throw new Error(endpoint.includes('/video') ? 'Video files must not exceed 80 MB' : 'Assignment files must not exceed 15 MB');\n    const ext = file.name.toLowerCase().split('.').pop();\n    const fallback = {mp4:'video/mp4',webm:'video/webm',ogg:'video/ogg',pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};\n    const contentType = fallback[ext] || file.type || 'application/octet-stream';\n    const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': contentType, 'X-File-Name': encodeURIComponent(file.name) }, body: file });\n    const result = await response.json().catch(() => ({}));\n    if (!response.ok) throw new Error(result.error || 'File upload failed');\n    return result;\n  }\n  document.addEventListener('click', event => {\n    const node = event.target.closest('[data-action]');\n    if (!node || !state.user) return;\n    const action = node.dataset.action;\n    const id = node.dataset.id;\n    if (action === 'open-lesson') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      state.activeLesson = id;\n      state.lessonFolders = [];\n      state.lessonResourcesFor = null;\n      state.lessonFoldersLoading = true;\n      render();\n      setTimeout(() => $('.lesson-open')?.scrollIntoView({ behavior:'smooth', block:'nearest' }), 0);\n      if (['teacher','admin'].includes(state.user.role) || state.selectedCourse?.enrolled) {\n        run(async () => {\n          try { await refreshLessonFolders(id); }\n          catch (error) {\n            if (state.activeLesson === id) { state.lessonFoldersLoading = false; state.lessonResourcesFor = id; render(); }\n            throw error;\n          }\n        }, 'Could not load lesson files: ');\n      }\n      return;\n    }\n    if (action === 'delete-lesson-folder') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      if (!confirm('Delete this folder and all its files?')) return;\n      const lessonId = node.dataset.lessonId;\n      run(async () => {\n        await api('/api/lessons/' + encodeURIComponent(lessonId) + '/folders/' + encodeURIComponent(id), { method:'DELETE' });\n        await refreshLessonFolders(lessonId);\n        showToast('Folder deleted');\n      }, 'Could not delete folder: ');\n      return;\n    }\n    if (action === 'delete-lesson-file') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      if (!confirm('Delete this file?')) return;\n      const lessonId = node.dataset.lessonId;\n      run(async () => {\n        await api('/api/lessons/' + encodeURIComponent(lessonId) + '/folders/' + encodeURIComponent(node.dataset.folderId) + '/files/' + encodeURIComponent(id), { method:'DELETE' });\n        await refreshLessonFolders(lessonId);\n        showToast('File deleted');\n      }, 'Could not delete file: ');\n      return;\n    }\n    if (action === 'show-enroll-code') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      run(() => navigate('enrollcode'));\n    }\n    if (action === 'unenroll') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      if (!confirm('Withdraw from this course? You will lose access to its materials; past grades and assignments will no longer appear.')) return;\n      run(async () => {\n        await api('/api/courses/' + encodeURIComponent(id) + '/unenroll', { method: 'POST', body: '{}' });\n        await refreshCourses();\n        state.selectedCourse = null;\n        state.page = 'enrollcode';\n        render(); showToast('You have withdrawn from the course');\n      }, 'Withdrawal failed: ');\n    }\n    if (action === 'open-gradebook') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      run(async () => {\n        const data = await api('/api/courses/' + encodeURIComponent(id));\n        state.selectedCourse = data.course;\n        state.page = 'gradebook';\n        state.activeTab = 'gradebook';\n        await refreshGradebook();\n        render();\n        window.scrollTo({ top: 0, behavior: 'smooth' });\n      }, 'Could not open gradebook: ');\n      return;\n    }\n    if (action === 'publish-gradebook') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      if (!confirm('确认成绩完整无误，并一键发布给本课程所有学生？')) return;\n      run(async () => {\n        const res = await api('/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/gradebook/publish', { method: 'POST', body: '{}' });\n        await refreshGradebook(); render();\n        showToast('成绩已发布给 ' + res.publishedCount + ' 名学生');\n      }, '发布失败: ');\n      return;\n    }\n    if (action === 'unpublish-gradebook') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      if (!confirm('撤回后学生端将不再显示本课程成绩，确认撤回？')) return;\n      run(async () => {\n        await api('/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/gradebook/unpublish', { method: 'POST', body: '{}' });\n        await refreshGradebook(); render(); showToast('成绩已撤回发布');\n      }, '撤回失败: ');\n      return;\n    }\n    if (action === 'export-gradebook') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      const book = state.gradebook || {};\n      const courseTitle = state.selectedCourse?.title || 'gradebook';\n      const header = ['学号', '姓名'].concat(gradeKeys.map(key => gradeNames[key])).concat(['总成绩']);\n      const rows = (book.students || []).map(stu => [stu.studentId || '', stu.name || ''].concat(gradeKeys.map(key => stu.scores?.[key] == null ? '' : stu.scores[key])).concat([stu.total == null ? '' : stu.total]));\n      const csv = '\\uFEFF' + [header, ...rows].map(row => row.map(value => '\"' + String(value).replace(/\"/g, '\"\"') + '\"').join(',')).join('\\r\\n');\n      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });\n      const link = document.createElement('a');\n      link.href = URL.createObjectURL(blob);\n      link.download = courseTitle.replace(/[\\\\/:*?\"<>|]/g, '_') + '-gradebook.csv';\n      document.body.appendChild(link); link.click(); link.remove();\n      setTimeout(() => URL.revokeObjectURL(link.href), 0);\n      showToast('Gradebook exported');\n      return;\n    }\n    if (action === 'open-course-tab') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      run(() => loadCourse(id, node.dataset.tab || 'lessons'));\n    }\n    if (action === 'new-assignment' || action === 'edit-assignment') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      state.modal = { type: 'assignment', assignment: action === 'edit-assignment' ? state.assignments.find(a => a.id === id) : null };\n      render();\n    }\n    if (action === 'delete-assignment') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      if (!confirm('Delete this assignment and all student submissions?')) return;\n      run(async () => {\n        await api('/api/assignments/' + encodeURIComponent(id), { method: 'DELETE' });\n        if (state.assignmentSelected === id) state.assignmentSelected = null;\n        await refreshAssignments(); render(); showToast('Assignment deleted');\n      }, 'Could not delete assignment: ');\n    }\n    if (action === 'view-submissions') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      run(async () => {\n        state.assignmentSelected = id;\n        const data = await api('/api/assignments/' + encodeURIComponent(id) + '/submissions');\n        state.submissions = data.submissions || [];\n        render();\n      }, 'Could not load submissions: ');\n    }\n    if (action === 'hide-submissions') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      state.assignmentSelected = null; state.submissions = []; render();\n    }\n    if (action === 'grade-submission') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      state.modal = { type: 'submission-grade', submission: state.submissions.find(s => s.id === id) };\n      render();\n    }\n  }, true);\n  document.addEventListener('submit', event => {\n    const form = event.target;\n    if (!state.user) return;\n    if (form.id === 'lesson-folder-form') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      const lessonId = form.dataset.lessonId;\n      const name = String(new FormData(form).get('name') || '').trim();\n      if (!name) { showToast('Enter a folder name', true); return; }\n      run(async () => {\n        await api('/api/lessons/' + encodeURIComponent(lessonId) + '/folders', { method:'POST', body:JSON.stringify({name}) });\n        await refreshLessonFolders(lessonId);\n        showToast('Folder created');\n      }, 'Could not create folder: ');\n      return;\n    }\n    if (form.classList.contains('lesson-file-upload')) {\n      event.preventDefault(); event.stopImmediatePropagation();\n      const lessonId = form.dataset.lessonId;\n      const folderId = form.dataset.folderId;\n      const files = Array.from(form.querySelector('input[type=file]')?.files || []);\n      const folder = state.lessonFolders.find(x => x.id === folderId);\n      if (!files.length) { showToast('Choose files to upload', true); return; }\n      const allowedExtensions = new Set(['pdf','doc','docx','ppt','pptx','xls','xlsx','txt','csv','png','jpg','jpeg','webp','zip']);\n      if (files.some(file => !allowedExtensions.has(file.name.toLowerCase().split('.').pop()))) { showToast('Only PDF, Word, PowerPoint, Excel, text, image, or ZIP files are supported', true); return; }\n      if ((folder?.files?.length || 0) + files.length > 50) { showToast('A folder can contain at most 50 files', true); return; }\n      if (files.some(file => file.size > 15 * 1024 * 1024)) { showToast('Each file must be 15 MB or less', true); return; }\n      run(async () => {\n        const types = {pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',txt:'text/plain',csv:'text/csv',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',zip:'application/zip'};\n        for (const file of files) {\n          const extension = file.name.toLowerCase().split('.').pop();\n          const response = await fetch('/api/lessons/' + encodeURIComponent(lessonId) + '/folders/' + encodeURIComponent(folderId) + '/files', {method:'POST',credentials:'same-origin',headers:{'Content-Type':types[extension] || file.type || 'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});\n          const result = await response.json().catch(() => ({}));\n          if (!response.ok) {\n            await refreshLessonFolders(lessonId);\n            throw new Error(result.error || `Could not upload ${file.name}`);\n          }\n        }\n        await refreshLessonFolders(lessonId);\n        showToast(`${files.length} file${files.length === 1 ? '' : 's'} uploaded`);\n      }, 'File upload failed: ');\n      return;\n    }\n    if (form.id === 'course-form') {\n      const code = form.querySelector('[name=\"enrollmentCode\"]');\n      if (code && !code.value.trim()) code.disabled = true;\n      return;\n    }\n    if (form.id === 'lesson-form') {\n      const file = form.querySelector('#lesson-upload')?.files?.[0];\n      if (!file) return;\n      event.preventDefault(); event.stopImmediatePropagation();\n      if (file.size > 80 * 1024 * 1024) { showToast('Video files must not exceed 80 MB', true); return; }\n      if (!['mp4','webm','ogg'].includes(file.name.toLowerCase().split('.').pop())) { showToast('Only MP4, WebM, or OGG videos are supported', true); return; }\n      const data = Object.fromEntries(new FormData(form));\n      const current = state.modal?.lesson;\n      run(async () => {\n        const endpoint = current?.id ? '/api/lessons/' + encodeURIComponent(current.id) : '/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/lessons';\n        const response = await api(endpoint, { method:current?.id ? 'PATCH' : 'POST', body:JSON.stringify(data) });\n        const lessonId = response.lesson?.id || current?.id;\n        await uploadFile('/api/lessons/' + encodeURIComponent(lessonId) + '/video', file);\n        state.modal = null; await refreshCourses(); await reloadSelected(); showToast('Lesson and video saved');\n      }, 'Video upload failed: ');\n      return;\n    }\n    if (form.id === 'enroll-code-form') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      const code = new FormData(form).get('code')?.toString().trim();\n      run(async () => {\n        const data = await api('/api/courses/enroll-by-code', { method:'POST', body:JSON.stringify({code}) });\n        await refreshCourses();\n        showToast('Course joined. You can start learning now!');\n        await loadCourse(data.course.id);\n      }, 'Could not join course: ');\n    }\n    if (form.id === 'assignment-form') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      const data = Object.fromEntries(new FormData(form));\n      data.maxScore = Number(data.maxScore);\n      data.dueAt = data.dueAt ? new Date(data.dueAt).toISOString() : '';\n      const existing = state.modal?.assignment;\n      run(async () => {\n        const endpoint = existing?.id ? '/api/assignments/' + encodeURIComponent(existing.id) : '/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/assignments';\n        await api(endpoint, { method: existing?.id ? 'PATCH' : 'POST', body:JSON.stringify(data) });\n        state.modal = null; await refreshAssignments(); render(); showToast('Assignment saved');\n      }, 'Could not save assignment: ');\n    }\n    if (form.classList.contains('assignment-submit-form')) {\n      event.preventDefault(); event.stopImmediatePropagation();\n      const fd = new FormData(form);\n      const content = String(fd.get('content') || '').trim();\n      const file = fd.get('file');\n      if (!content && !(file instanceof File && file.size)) { showToast('Enter a response or select a file', true); return; }\n      if (file instanceof File && file.size > 15 * 1024 * 1024) { showToast('Assignment files must not exceed 15 MB', true); return; }\n      const assignmentId = form.dataset.assignmentId;\n      run(async () => {\n        await api('/api/assignments/' + encodeURIComponent(assignmentId) + '/submit', { method:'POST', body:JSON.stringify({content}) });\n        if (file instanceof File && file.size) await uploadFile('/api/assignments/' + encodeURIComponent(assignmentId) + '/submission/file', file);\n        await refreshAssignments(); render(); showToast('Assignment submitted');\n      }, 'Could not submit assignment: ');\n    }\n    if (form.id === 'submission-grade-form') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      const values = Object.fromEntries(new FormData(form));\n      const submissionId = state.modal?.submission?.id;\n      run(async () => {\n        await api('/api/submissions/' + encodeURIComponent(submissionId) + '/grade', { method:'PATCH', body:JSON.stringify({ score:Number(values.score), feedback:values.feedback }) });\n        state.modal = null;\n        const data = await api('/api/assignments/' + encodeURIComponent(state.assignmentSelected) + '/submissions');\n        state.submissions = data.submissions || [];\n        await refreshAssignments(); await refreshGradebook(); render(); showToast('Grade saved and synced to the gradebook');\n      }, 'Could not save grade: ');\n    }\n    if (form.id === 'weights-form') {\n      event.preventDefault(); event.stopImmediatePropagation();\n      const raw = Object.fromEntries(new FormData(form));\n      const weights = Object.fromEntries(gradeKeys.map(key => [key, Number(raw[key])]));\n      if (Math.abs(Object.values(weights).reduce((a,b)=>a+b,0) - 100) > 0.000001) { showToast('The four grade weights must add up to 100%', true); return; }\n      run(async () => {\n        await api('/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/gradebook/weights', {method:'PUT',body:JSON.stringify({weights})});\n        await refreshGradebook(); render(); showToast('Grade weights updated');\n      }, 'Could not save grade weights: ');\n    }\n    if (form.classList.contains('grade-student-form')) {\n      event.preventDefault(); event.stopImmediatePropagation();\n      const raw = Object.fromEntries(new FormData(form));\n      const scores = Object.fromEntries(gradeKeys.map(key => [key, raw[key] === '' ? null : Number(raw[key])]));\n      run(async () => {\n        await api('/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/gradebook/' + encodeURIComponent(form.dataset.userId), {method:'PATCH',body:JSON.stringify({scores})});\n        await refreshGradebook(); render(); showToast('Student grades updated');\n      }, 'Could not save grades: ');\n    }\n  }, true);\n\n  document.addEventListener('change', async event => {\n    const input = event.target;\n    if (!input || input.id !== 'gradebook-import-file' || !input.files?.[0]) return;\n    const file = input.files[0];\n    const bytes = new Uint8Array(await file.arrayBuffer());\n    let binary = '';\n    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));\n    run(async () => {\n      const res = await api('/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/gradebook/import', {\n        method: 'POST',\n        body: JSON.stringify({ fileName: file.name, contentType: file.type || '', contentBase64: btoa(binary) })\n      });\n      await refreshGradebook(); render();\n      showToast('已导入 ' + (res.imported + res.updated) + ' 条成绩，请确认后一键发布');\n    }, '成绩导入失败: ');\n    input.value = '';\n  });\n})();\n";
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.ico':'image/x-icon', '.webp':'image/webp', '.woff2':'font/woff2', '.json':'application/json; charset=utf-8' };
function staticFile(req, res, url) {
  if (!['GET','HEAD'].includes(req.method)) return json(res, 405, { error: 'Unsupported request method' });
  let requested;
  try { requested = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Invalid path' }); }
  const file = path.resolve(PUBLIC, `.${requested === '/' ? '/index.html' : requested}`);
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Invalid path' });
  let target = file;
  try { if (!fs.statSync(target).isFile()) target = path.join(PUBLIC, 'index.html'); } catch { target = path.join(PUBLIC, 'index.html'); }
  fs.readFile(target, (err, content) => {
    if (err) return json(res, 404, { error: 'Page not found' });
    if (target.endsWith(path.sep + 'admin.js')) {
      content = Buffer.from(ADMIN_JS_PATCHED, 'utf8');
    }
    if (target.endsWith(path.sep + 'scheduling.js')) {
      content = Buffer.from(SCHEDULING_JS_FULL, 'utf8');
      if (!content.includes('scheduleCourseSyncPatch')) {
        content = Buffer.concat([content, Buffer.from('\n' + SCHEDULING_FRONTEND_PATCH, 'utf8')]);
      }
    }
    if (target.endsWith(path.sep + 'v2.js')) {
      content = Buffer.from(V2_JS_FULL, 'utf8');
      if (!content.includes('lessonQuizPanel')) {
        content = Buffer.concat([content, Buffer.from(LESSON_QUIZ_FRONTEND, 'utf8')]);
      }
    }
    const ext = path.extname(target);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
    if (['.js', '.html', '.css', '.json'].includes(ext)) headers['Cache-Control'] = 'no-store, max-age=0, must-revalidate';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : content);
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else staticFile(req, res, url);
  } catch (error) {
    if (res.writableEnded || res.destroyed) return;
    if (!(error instanceof HttpError)) console.error(error);
    json(res, error.status || 500, { error: error instanceof HttpError ? error.message : 'The server cannot process this request right now' });
  }
});
if (require.main === module) server.listen(PORT, HOST, () => console.log(`Campus learning platform: http://localhost:${PORT}`));
module.exports = { server, db };
