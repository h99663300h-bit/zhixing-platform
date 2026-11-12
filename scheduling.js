// Zero-dependency intelligent course scheduling engine (51-style constraints, greedy + backtracking solver, conflict & substitute finder).
const crypto = require('node:crypto');

const id = prefix => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

function defaultPeriods() {
  return [
    { id: 'p1', index: 1, name: '第1节', startTime: '08:00', endTime: '08:45', isBreak: false, breakLabel: '' },
    { id: 'p2', index: 2, name: '第2节', startTime: '08:55', endTime: '09:40', isBreak: false, breakLabel: '' },
    { id: 'b1', index: 2.5, name: '大课间', startTime: '09:40', endTime: '10:10', isBreak: true, breakLabel: '不上课' },
    { id: 'p3', index: 3, name: '第3节', startTime: '10:10', endTime: '10:55', isBreak: false, breakLabel: '' },
    { id: 'p4', index: 4, name: '第4节', startTime: '11:05', endTime: '11:50', isBreak: false, breakLabel: '' },
    { id: 'b2', index: 4.5, name: '午休', startTime: '11:50', endTime: '14:00', isBreak: true, breakLabel: '不上课' },
    { id: 'p5', index: 5, name: '第5节', startTime: '14:00', endTime: '14:45', isBreak: false, breakLabel: '' },
    { id: 'p6', index: 6, name: '第6节', startTime: '14:55', endTime: '15:40', isBreak: false, breakLabel: '' },
    { id: 'b3', index: 6.5, name: '课外活动', startTime: '15:40', endTime: '16:30', isBreak: true, breakLabel: '可选排兴趣课' },
  ];
}

function emptyScope() {
  return {
    settings: {
      schoolLevel: '高中',
      campusName: '主校区',
      daysPerWeek: 5,
      periods: defaultPeriods(),
      blockedSlots: [], // [{ key: '1-p1', reason: '升旗仪式' }]
    },
    grades: [],
    classes: [],
    subjects: [],
    rooms: [],
    teacherRules: {},
    plans: [], // [{ id, classId, subjectId, teacherId, roomId, weeklyHours, fixed }]
    entries: [], // [{ id, planId, classId, subjectId, teacherId, roomId, day, periodId, locked, temporary, overrideReason, updatedAt }]
    published: null, // { publishedAt, publishedBy, settings, grades, classes, subjects, rooms, entries }
    swapRequests: [],
    auditLogs: [],
    archives: [],
  };
}

function ensureScope(db, scopeKey) {
  if (!db.scheduling || typeof db.scheduling !== 'object') db.scheduling = {};
  if (!db.scheduling[scopeKey]) db.scheduling[scopeKey] = emptyScope();
  const s = db.scheduling[scopeKey];
  if (!s.settings) s.settings = emptyScope().settings;
  if (!Array.isArray(s.settings.periods) || !s.settings.periods.length) s.settings.periods = defaultPeriods();
  if (!Array.isArray(s.settings.blockedSlots)) s.settings.blockedSlots = [];
  for (const k of ['grades', 'classes', 'subjects', 'rooms', 'plans', 'entries', 'swapRequests', 'auditLogs', 'archives']) {
    if (!Array.isArray(s[k])) s[k] = [];
  }
  if (!s.teacherRules || typeof s.teacherRules !== 'object') s.teacherRules = {};
  return s;
}

function slotKey(day, periodId) {
  return `${day}-${periodId}`;
}

function teachingPeriods(scope) {
  return (scope.settings?.periods || []).filter(p => !p.isBreak);
}

function isMorningPeriod(scope, periodId) {
  const list = teachingPeriods(scope);
  const idx = list.findIndex(p => p.id === periodId);
  return idx >= 0 && idx < Math.ceil(list.length / 2);
}

function isLastPeriod(scope, periodId) {
  const list = teachingPeriods(scope);
  return list.length > 0 && list[list.length - 1].id === periodId;
}

function isFirstPeriod(scope, periodId) {
  const list = teachingPeriods(scope);
  return list.length > 0 && list[0].id === periodId;
}

// Validates a candidate entry against H01-H06 (hard) and M01-M06 / soft rules.
function checkPlacement(scope, candidate, ignoreEntryIds = new Set()) {
  const hard = [];
  const warnings = [];
  const days = Number(scope.settings?.daysPerWeek || 5);
  const day = Number(candidate.day);
  const period = (scope.settings?.periods || []).find(p => p.id === candidate.periodId);

  // H03: Valid teaching period & day
  if (!Number.isInteger(day) || day < 1 || day > days || !period || period.isBreak) {
    hard.push({ code: 'H03', message: '所选节次为非上课时段或超出每周上课天数' });
  }

  const key = slotKey(day, candidate.periodId);
  const globalBlocked = (scope.settings?.blockedSlots || []).find(b => b.key === key);
  if (globalBlocked) {
    hard.push({ code: 'H06', message: `该时段已全校锁定（${globalBlocked.reason || '特殊时段'}），不可排课` });
  }

  const cls = scope.classes.find(c => c.id === candidate.classId);
  const subj = scope.subjects.find(s => s.id === candidate.subjectId);
  const tr = scope.teacherRules[candidate.teacherId] || {};
  const room = candidate.roomId ? scope.rooms.find(r => r.id === candidate.roomId) : null;

  // H06: Class, teacher, room blocked slots
  if (cls && Array.isArray(cls.blockedSlots) && cls.blockedSlots.includes(key)) {
    hard.push({ code: 'H06', message: `${cls.name} 在该时段设置了不可排课` });
  }
  if (Array.isArray(tr.blockedSlots) && tr.blockedSlots.includes(key)) {
    hard.push({ code: 'H06', message: '该教师在该时段设置了固定不可排时间' });
  }
  if (Array.isArray(tr.availableSlots) && tr.availableSlots.length && !tr.availableSlots.includes(key)) {
    hard.push({ code: 'H06', message: '该时段不在教师设定的固定可排时间内' });
  }
  if (room && Array.isArray(room.blockedSlots) && room.blockedSlots.includes(key)) {
    hard.push({ code: 'H06', message: `教室 ${room.name} 在该时段不可用` });
  }

  // H01, H02, H05: Uniqueness in entries
  for (const e of scope.entries) {
    if (ignoreEntryIds.has(e.id)) continue;
    if (Number(e.day) !== day || e.periodId !== candidate.periodId) continue;
    if (e.teacherId === candidate.teacherId) {
      const otherCls = scope.classes.find(c => c.id === e.classId)?.name || '其他班级';
      hard.push({ code: 'H01', message: `教师冲突：该教师周${day}此节次已在 ${otherCls} 排课` });
    }
    if (e.classId === candidate.classId) {
      const otherSubj = scope.subjects.find(s => s.id === e.subjectId)?.name || '其他科目';
      hard.push({ code: 'H02', message: `班级冲突：${cls?.name || '该班级'} 周${day}此节次已安排 ${otherSubj}` });
    }
    if (candidate.roomId && e.roomId === candidate.roomId) {
      hard.push({ code: 'H05', message: `场地冲突：教室 ${room?.name || ''} 该时段已被占用` });
    }
  }

  // H04: Teacher-Class-Subject plan check (if plans exist)
  if (scope.plans.length && candidate.planId !== 'custom') {
    const matchedPlan = scope.plans.find(p => p.classId === candidate.classId && p.subjectId === candidate.subjectId && p.teacherId === candidate.teacherId);
    if (!matchedPlan) {
      hard.push({ code: 'H04', message: '教师-班级-科目未在授课计划中匹配' });
    }
  }

  // M03: Teacher daily max periods
  const maxDaily = Number(tr.maxDailyPeriods || 0);
  if (maxDaily > 0) {
    const dayCount = scope.entries.filter(e => !ignoreEntryIds.has(e.id) && Number(e.day) === day && e.teacherId === candidate.teacherId).length;
    if (dayCount >= maxDaily) {
      warnings.push({ code: 'M03', message: `该教师周${day}已排满 ${dayCount} 节课（上限 ${maxDaily} 节）` });
    }
  }

  // M05: Same subject max 2 periods per day for a class
  const subjDayCount = scope.entries.filter(e => !ignoreEntryIds.has(e.id) && Number(e.day) === day && e.classId === candidate.classId && e.subjectId === candidate.subjectId).length;
  if (subjDayCount >= 2) {
    warnings.push({ code: 'M05', message: `${cls?.name || '该班级'} 周${day}的 ${subj?.name || '该科目'} 已达 ${subjDayCount} 节` });
  }

  // Soft preference checks
  if (subj?.avoidLastPeriod && isLastPeriod(scope, candidate.periodId)) {
    warnings.push({ code: 'SOFT', message: `${subj.name} 建议避开最后一节` });
  }
  if (subj?.preference === 'morning' && !isMorningPeriod(scope, candidate.periodId)) {
    warnings.push({ code: 'SOFT', message: `${subj.name} 建议优先安排在上午时段` });
  }
  if (subj?.preference === 'afternoon' && isMorningPeriod(scope, candidate.periodId)) {
    warnings.push({ code: 'SOFT', message: `${subj.name} 建议优先安排在下午时段` });
  }

  return { valid: hard.length === 0, hard, warnings };
}

function detectAllConflicts(scope) {
  const list = [];
  for (const e of scope.entries) {
    const others = new Set([e.id]);
    const res = checkPlacement(scope, e, others);
    if (res.hard.length || res.warnings.length) {
      list.push({ entryId: e.id, day: e.day, periodId: e.periodId, classId: e.classId, teacherId: e.teacherId, subjectId: e.subjectId, hard: res.hard, warnings: res.warnings });
    }
  }
  return list;
}

function scoreSlot(scope, plan, subj, tr, day, periodId) {
  let score = 100;
  if (subj?.tier === 'major' && isMorningPeriod(scope, periodId)) score += 30;
  if (subj?.tier === 'minor' && !isMorningPeriod(scope, periodId)) score += 10;
  if (subj?.preference === 'morning' && isMorningPeriod(scope, periodId)) score += 25;
  if (subj?.preference === 'afternoon' && !isMorningPeriod(scope, periodId)) score += 25;
  if (subj?.avoidLastPeriod && isLastPeriod(scope, periodId)) score -= 25;
  if (subj?.tier !== 'major' && day === 1 && isFirstPeriod(scope, periodId)) score -= 15;
  if (subj?.tier !== 'major' && day === Number(scope.settings?.daysPerWeek || 5) && isLastPeriod(scope, periodId)) score -= 15;
  // Balance daily load for class
  const classDayLoad = scope.entries.filter(e => e.classId === plan.classId && Number(e.day) === day).length;
  score -= classDayLoad * 6;
  // Spread subject across different days
  const sameSubjSameDay = scope.entries.filter(e => e.classId === plan.classId && e.subjectId === plan.subjectId && Number(e.day) === day).length;
  score -= sameSubjSameDay * 35;
  // Balance teacher load across days
  const teacherDayLoad = scope.entries.filter(e => e.teacherId === plan.teacherId && Number(e.day) === day).length;
  score -= teacherDayLoad * 5;
  if (tr?.preference === 'morning' && isMorningPeriod(scope, periodId)) score += 15;
  if (tr?.preference === 'afternoon' && !isMorningPeriod(scope, periodId)) score += 15;
  return score;
}

// Finds adjacent teaching period pairs that do NOT cross a break/lunch!
function adjacentPeriodPairs(scope, count = 2) {
  const all = scope.settings?.periods || [];
  const pairs = [];
  for (let i = 0; i <= all.length - count; i++) {
    const slice = all.slice(i, i + count);
    if (slice.every(p => !p.isBreak)) pairs.push(slice.map(p => p.id));
  }
  return pairs;
}

function autoSchedule(scope, options = {}) {
  const days = Number(scope.settings?.daysPerWeek || 5);
  const tPeriods = teachingPeriods(scope);
  // Keep locked entries (or entries matching filter)
  const gradeFilter = options.gradeId ? new Set(scope.classes.filter(c => c.gradeId === options.gradeId).map(c => c.id)) : null;
  const kept = scope.entries.filter(e => e.locked || (gradeFilter && !gradeFilter.has(e.classId)));
  scope.entries = kept.map(e => ({ ...e }));

  const targetPlans = scope.plans.filter(p => !gradeFilter || gradeFilter.has(p.classId));
  // Sort plans: fixed first -> consecutive -> major -> minor -> public -> highest weeklyHours
  const tierRank = { major: 3, minor: 2, public: 1 };
  const sortedPlans = targetPlans.slice().sort((a, b) => {
    if (Boolean(a.fixed) !== Boolean(b.fixed)) return a.fixed ? -1 : 1;
    const sa = scope.subjects.find(s => s.id === a.subjectId);
    const sb = scope.subjects.find(s => s.id === b.subjectId);
    const ca = sa?.consecutiveMode === 'require' ? 1 : 0;
    const cb = sb?.consecutiveMode === 'require' ? 1 : 0;
    if (ca !== cb) return cb - ca;
    const ta = tierRank[sa?.tier] || 2;
    const tb = tierRank[sb?.tier] || 2;
    if (ta !== tb) return tb - ta;
    return Number(b.weeklyHours || 0) - Number(a.weeklyHours || 0);
  });

  const unplaced = [];
  let placedCount = 0;

  for (const plan of sortedPlans) {
    const existingCount = scope.entries.filter(e => e.classId === plan.classId && e.subjectId === plan.subjectId && e.teacherId === plan.teacherId).length;
    let remaining = Math.max(0, Number(plan.weeklyHours || 0) - existingCount);
    const subj = scope.subjects.find(s => s.id === plan.subjectId);
    const tr = scope.teacherRules[plan.teacherId] || {};

    // Place consecutive blocks first if required
    if (subj?.consecutiveMode === 'require' && remaining >= 2) {
      const blockSize = Math.min(Number(subj.consecutiveCount || 2), remaining);
      const pairs = adjacentPeriodPairs(scope, blockSize);
      const maxBlocks = Number(subj.maxConsecutivePerWeek || 2);
      let blocksPlaced = 0;
      while (remaining >= blockSize && blocksPlaced < maxBlocks) {
        const candidates = [];
        for (let day = 1; day <= days; day++) {
          for (const pIds of pairs) {
            const checks = pIds.map(pid => checkPlacement(scope, { ...plan, day, periodId: pid }));
            if (checks.every(c => c.valid)) {
              const totalScore = pIds.reduce((sum, pid) => sum + scoreSlot(scope, plan, subj, tr, day, pid), 0);
              candidates.push({ day, pIds, score: totalScore });
            }
          }
        }
        if (!candidates.length) break;
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];
        for (const pid of best.pIds) {
          scope.entries.push({
            id: id('ent'), planId: plan.id, classId: plan.classId, subjectId: plan.subjectId,
            teacherId: plan.teacherId, roomId: plan.roomId || null, day: best.day, periodId: pid,
            locked: Boolean(plan.fixed), temporary: false, overrideReason: '', updatedAt: now(),
          });
          remaining--;
          placedCount++;
        }
        blocksPlaced++;
      }
    }

    // Place remaining single lessons
    while (remaining > 0) {
      const candidates = [];
      for (let day = 1; day <= days; day++) {
        for (const p of tPeriods) {
          const chk = checkPlacement(scope, { ...plan, day, periodId: p.id });
          if (chk.valid) {
            const penalty = chk.warnings.length * 20;
            candidates.push({ day, periodId: p.id, score: scoreSlot(scope, plan, subj, tr, day, p.id) - penalty });
          }
        }
      }
      if (!candidates.length) {
        unplaced.push({ planId: plan.id, classId: plan.classId, subjectId: plan.subjectId, teacherId: plan.teacherId, remaining });
        break;
      }
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      scope.entries.push({
        id: id('ent'), planId: plan.id, classId: plan.classId, subjectId: plan.subjectId,
        teacherId: plan.teacherId, roomId: plan.roomId || null, day: best.day, periodId: best.periodId,
        locked: Boolean(plan.fixed), temporary: false, overrideReason: '', updatedAt: now(),
      });
      remaining--;
      placedCount++;
    }
  }

  return { placedCount, unplaced, conflicts: detectAllConflicts(scope), totalEntries: scope.entries.length };
}

function suggestAlternatives(scope, entryOrPlan, limit = 3) {
  const days = Number(scope.settings?.daysPerWeek || 5);
  const tPeriods = teachingPeriods(scope);
  const subj = scope.subjects.find(s => s.id === entryOrPlan.subjectId);
  const tr = scope.teacherRules[entryOrPlan.teacherId] || {};
  const ignore = entryOrPlan.id ? new Set([entryOrPlan.id]) : new Set();
  const options = [];
  for (let day = 1; day <= days; day++) {
    for (const p of tPeriods) {
      const chk = checkPlacement(scope, { ...entryOrPlan, day, periodId: p.id }, ignore);
      if (chk.valid) {
        options.push({ day, periodId: p.id, periodName: p.name, startTime: p.startTime, endTime: p.endTime, score: scoreSlot(scope, entryOrPlan, subj, tr, day, p.id) - chk.warnings.length * 20 });
      }
    }
  }
  options.sort((a, b) => b.score - a.score);
  return options.slice(0, limit);
}

function suggestSubstitutes(scope, allTeachers, day, periodId, subjectId) {
  return allTeachers.filter(t => {
    if (t.active === false) return false;
    const busy = scope.entries.some(e => Number(e.day) === Number(day) && e.periodId === periodId && e.teacherId === t.id);
    if (busy) return false;
    const tr = scope.teacherRules[t.id] || {};
    if (Array.isArray(tr.blockedSlots) && tr.blockedSlots.includes(slotKey(day, periodId))) return false;
    return true;
  }).slice(0, 5).map(t => ({ id: t.id, name: t.name, department: t.department || '' }));
}

module.exports = {
  id, now, defaultPeriods, emptyScope, ensureScope,
  checkPlacement, detectAllConflicts, autoSchedule,
  suggestAlternatives, suggestSubstitutes,
};
