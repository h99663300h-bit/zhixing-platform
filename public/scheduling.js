// 51-style Intelligent Course Scheduling Workspace (Admin) & Personal Timetable (Teacher/Student).
(() => {
  const DAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const PREFS_KEY = 'zhixing_timetable_prefs';
  function loadPrefs() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null;
      if (raw) return { displayMode: 'course_teacher_room', rowHeight: 'standard', fontSize: 'md', showWeekend: false, ...JSON.parse(raw) };
    } catch {}
    return { displayMode: 'course_teacher_room', rowHeight: 'standard', fontSize: 'md', showWeekend: false };
  }
  function savePrefs(prefs) {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
  }

  window.schedUI = {
    subTab: 'timetable', // timetable | basedata | approvals
    viewMode: 'class',   // class | teacher | room | overview | conflicts
    selectedClassId: '',
    selectedTeacherId: '',
    selectedRoomId: '',
    selectedRuleTeacherId: '',
    data: null,
    loading: false,
    error: '',
    dragEntryId: null,
    addSlot: null, // { day, periodId }
    conflictModal: null,
    myData: null,
    myLoading: false,
    examView: 'plan',
    selectedExamId: '',
    optionsOpen: false,
    prefs: loadPrefs(),
  };

  function getDisplayLines(e, scope, teachers) {
    const subj = scope.subjects.find(s => s.id === e.subjectId)?.name || '课程';
    const tch = teachers.find(t => t.id === e.teacherId)?.name || '';
    const rm = scope.rooms.find(r => r.id === e.roomId)?.name || '';
    const mode = schedUI.prefs.displayMode || 'course_teacher_room';
    if (mode === 'course') return [subj];
    if (mode === 'course_teacher') return [subj, tch].filter(Boolean);
    if (mode === 'teacher') return [tch || '未指定教师'];
    if (mode === 'room') return [rm || '未指定教室'];
    return [subj, tch, rm].filter(Boolean);
  }
  function getStyleMetrics() {
    const pad = schedUI.prefs.rowHeight === 'compact' ? '4px 6px' : schedUI.prefs.rowHeight === 'relaxed' ? '11px 10px' : '7px 9px';
    const font = schedUI.prefs.fontSize === 'sm' ? '11px' : schedUI.prefs.fontSize === 'lg' ? '15px' : '13px';
    return { pad, font };
  }
  function getDayNames(days) {
    const count = schedUI.prefs.showWeekend ? Math.max(Number(days || 5), 7) : Number(days || 5);
    return Array.from({ length: count }, (_, i) => ({ day: i + 1, label: DAYS[i + 1] || ('周' + (i + 1)) }));
  }

  async function loadAdminSchedule() {
    if (schedUI.loading) return;
    schedUI.loading = true;
    try {
      schedUI.data = await api('/api/admin/schedule');
      schedUI.error = '';
      const sc = schedUI.data.scope;
      if (!schedUI.selectedClassId && sc.classes.length) schedUI.selectedClassId = sc.classes[0].id;
      if (!schedUI.selectedTeacherId && schedUI.data.teachers.length) schedUI.selectedTeacherId = schedUI.data.teachers[0].id;
      if (!schedUI.selectedRoomId && sc.rooms.length) schedUI.selectedRoomId = sc.rooms[0].id;
      if (!schedUI.selectedRuleTeacherId && schedUI.data.teachers.length) schedUI.selectedRuleTeacherId = schedUI.data.teachers[0].id;
    } catch (err) {
      schedUI.error = err.message;
    } finally {
      schedUI.loading = false;
      render();
    }
  }

  async function refreshAdminSchedule() {
    schedUI.data = await api('/api/admin/schedule');
    const sc = schedUI.data.scope;
    if (!schedUI.selectedClassId && sc.classes.length) schedUI.selectedClassId = sc.classes[0].id;
    if (!schedUI.selectedTeacherId && schedUI.data.teachers.length) schedUI.selectedTeacherId = schedUI.data.teachers[0].id;
    if (!schedUI.selectedRoomId && sc.rooms.length) schedUI.selectedRoomId = sc.rooms[0].id;
    render();
  }

  async function loadMyTimetable() {
    if (schedUI.myLoading) return;
    schedUI.myLoading = true;
    try {
      schedUI.myData = await api('/api/schedule/my');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      schedUI.myLoading = false;
      render();
    }
  }

  function renderCellCard(e, scope, teachers, conflictSet) {
    const lines = getDisplayLines(e, scope, teachers);
    const { pad, font } = getStyleMetrics();
    const hasConflict = conflictSet.has(e.id);
    const border = hasConflict ? '2px solid #dc2626' : e.temporary ? '1.5px dashed #3b82f6' : '1px solid var(--border)';
    const bg = hasConflict ? '#fef2f2' : e.locked ? '#f8fafc' : '#fff';
    return '<div draggable="' + (!e.locked) + '" data-sched-entry="' + esc(e.id) + '" style="padding:' + pad + ';font-size:' + font + ';border-radius:8px;border:' + border + ';background:' + bg + ';cursor:' + (e.locked ? 'default' : 'grab') + ';margin-bottom:4px">' +
      '<div class="row-between" style="gap:4px"><strong>' + esc(lines[0] || '') + '</strong>' +
      '<span>' + (e.locked ? '🔒' : '') + (e.groupId ? '<span class="pill" style="background:#ede9fe;color:#5b21b6;font-size:10px;padding:1px 5px">合班</span>' : '') + (e.temporary ? '<span class="pill blue" style="font-size:10px;padding:1px 5px">临时</span>' : '') + (hasConflict ? '<span class="pill" style="background:#fee2e2;color:#b91c1c;font-size:10px;padding:1px 5px">冲突</span>' : '') + '</span></div>' +
      (lines.length > 1 ? '<div class="tiny muted" style="white-space:pre-line">' + esc(lines.slice(1).join('\n')) + '</div>' : '') +
      '<div class="row" style="gap:6px;margin-top:4px">' +
      '<button type="button" class="btn-text" style="font-size:11px;padding:0" data-sched-action="toggle-lock" data-id="' + esc(e.id) + '">' + (e.locked ? '解锁' : '锁定') + '</button>' +
      '<button type="button" class="btn-text" style="font-size:11px;padding:0;color:#dc2626" data-sched-action="delete-entry" data-id="' + esc(e.id) + '">删除</button>' +
      '</div></div>';
  }

  function renderTimetableGrid(scope, teachers, entries, filterType, targetId, conflictSet) {
    const days = getDayNames(scope.settings.daysPerWeek);
    const periods = scope.settings.periods || [];
    const blockedSet = new Set((scope.settings.blockedSlots || []).map(b => b.key));
    const header = '<tr><th style="width:110px">节次 / 时间</th>' + days.map(d => '<th>' + d.label + '</th>').join('') + '</tr>';
    const rows = periods.map(p => {
      if (p.isBreak) {
        return '<tr style="background:#f3f4f6"><td colspan="' + (days.length + 1) + '" style="text-align:center;color:#6b7280;font-size:12px;padding:6px"><strong>' + esc(p.name) + '</strong> (' + esc(p.startTime) + '–' + esc(p.endTime) + ') · ' + esc(p.breakLabel || '不上课') + '</td></tr>';
      }
      const cells = days.map(d => {
        const key = d.day + '-' + p.id;
        if (blockedSet.has(key)) {
          return '<td style="background:#f3f4f6;color:#9ca3af;text-align:center;font-size:12px">全校锁定</td>';
        }
        const cellEntries = entries.filter(e => Number(e.day) === d.day && e.periodId === p.id);
        const groupActs = filterType === 'teacher' && targetId ? (scope.groupBlocks || []).filter(gb => {
          if (gb.active === false || Number(gb.day) !== d.day || !(gb.periodIds || []).includes(p.id)) return false;
          const grp = (scope.teacherGroups || []).find(g => g.id === gb.groupId);
          return grp && (grp.teacherIds || []).includes(targetId);
        }) : [];
        const actBadges = groupActs.map(gb => {
          const grpName = (scope.teacherGroups || []).find(g => g.id === gb.groupId)?.name || '';
          return '<div style="padding:5px 7px;border-radius:6px;background:' + esc(gb.color || '#fef3c7') + ';font-size:12px;margin-bottom:4px"><strong>' + esc(gb.icon || '🔔') + ' ' + esc(gb.label || gb.activityType) + '</strong><div class="tiny muted">' + esc(grpName) + '</div></div>';
        }).join('');
        const content = (cellEntries.length || actBadges)
          ? actBadges + cellEntries.map(e => renderCellCard(e, scope, teachers, conflictSet)).join('')
          : '<div class="tiny muted" style="text-align:center;padding:8px 0">' + (filterType === 'teacher' ? '无课' : '<button type="button" class="btn-text" style="font-size:11px" data-sched-action="open-add-slot" data-day="' + d.day + '" data-period="' + esc(p.id) + '">+ 排课</button>') + '</div>';
        return '<td data-sched-drop="1" data-day="' + d.day + '" data-period="' + esc(p.id) + '" style="vertical-align:top;min-width:130px">' + content + '</td>';
      }).join('');
      return '<tr><td><strong>' + esc(p.name) + '</strong><br><span class="tiny muted">' + esc(p.startTime) + '–' + esc(p.endTime) + '</span></td>' + cells + '</tr>';
    }).join('');
    return '<div class="table-wrap"><table class="data-table" style="border-collapse:collapse"><thead>' + header + '</thead><tbody>' + rows + '</tbody></table></div>';
  }

  function renderOptionsDropdown() {
    const pr = schedUI.prefs;
    const modes = [
      ['course', '只显示课程名称'],
      ['course_teacher', '显示课程名称 + 教师'],
      ['course_teacher_room', '显示课程名称 + 教师 + 教室'],
      ['teacher', '仅显示教师名称'],
      ['room', '仅显示教室名称'],
    ];
    return '<div style="position:relative;display:inline-block">' +
      '<button type="button" class="btn btn-light btn-sm" data-sched-action="toggle-options">⚙ 课表选项 ▾</button>' +
      (schedUI.optionsOpen ? '<div class="panel panel-pad" style="position:absolute;left:0;top:110%;z-index:50;min-width:255px;box-shadow:0 12px 32px rgba(15,23,42,.15)">' +
        '<div class="tiny muted" style="margin-bottom:6px"><strong>显示内容（实时生效）</strong></div>' +
        modes.map(([k, label]) => '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;cursor:pointer"><input type="radio" name="schedDisplayMode" data-sched-pref="displayMode" value="' + k + '"' + (pr.displayMode === k ? ' checked' : '') + '><span>' + label + '</span></label>').join('') +
        '<hr style="margin:8px 0;border:0;border-top:1px solid var(--border)">' +
        '<div class="tiny muted" style="margin-bottom:6px"><strong>📐 样式设置</strong></div>' +
        '<div class="field" style="margin-bottom:8px"><label class="tiny">行高</label><select data-sched-pref="rowHeight"><option value="compact"' + (pr.rowHeight==='compact'?' selected':'') + '>紧凑</option><option value="standard"' + (pr.rowHeight==='standard'?' selected':'') + '>标准</option><option value="relaxed"' + (pr.rowHeight==='relaxed'?' selected':'') + '>宽松</option></select></div>' +
        '<div class="field" style="margin-bottom:8px"><label class="tiny">字体大小</label><select data-sched-pref="fontSize"><option value="sm"' + (pr.fontSize==='sm'?' selected':'') + '>小</option><option value="md"' + (pr.fontSize==='md'?' selected':'') + '>中</option><option value="lg"' + (pr.fontSize==='lg'?' selected':'') + '>大</option></select></div>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" data-sched-pref="showWeekend"' + (pr.showWeekend ? ' checked' : '') + '><span>显示周末 (周六/日)</span></label>' +
        '</div>' : '') +
      '</div>';
  }

  function exportWysiwygExcel(d) {
    const scope = d.scope;
    const teachers = d.teachers || [];
    const conflicts = d.conflicts || [];
    const conflictSet = new Set(conflicts.filter(c => c.hard.length).map(c => c.entryId));
    const days = getDayNames(scope.settings.daysPerWeek);
    const periods = scope.settings.periods || [];
    const blockedSet = new Set((scope.settings.blockedSlots || []).map(b => b.key));
    const { pad, font } = getStyleMetrics();
    const targetClasses = schedUI.viewMode === 'class' && schedUI.selectedClassId
      ? scope.classes.filter(c => c.id === schedUI.selectedClassId)
      : scope.classes;
    let tables = '';
    for (const cls of targetClasses) {
      const entries = scope.entries.filter(e => e.classId === cls.id);
      let rows = '<tr><th style="background:#eef2ff;border:1px solid #cbd5e1;padding:6px">节次 / 时间</th>' +
        days.map(day => '<th style="background:' + (day.day >= 6 ? '#f1f5f9' : '#eef2ff') + ';border:1px solid #cbd5e1;padding:6px">' + day.label + '</th>').join('') + '</tr>';
      for (const p of periods) {
        if (p.isBreak) {
          rows += '<tr><td colspan="' + (days.length + 1) + '" style="background:#f3f4f6;color:#6b7280;text-align:center;border:1px solid #cbd5e1;padding:4px">' + esc(p.name) + ' (' + esc(p.startTime + '-' + p.endTime) + ')</td></tr>';
          continue;
        }
        const cells = days.map(day => {
          const key = day.day + '-' + p.id;
          if (blockedSet.has(key)) return '<td style="background:#e5e7eb;border:1px solid #cbd5e1;text-align:center">锁定</td>';
          const list = entries.filter(e => Number(e.day) === day.day && e.periodId === p.id);
          if (!list.length) return '<td style="border:1px solid #cbd5e1;background:' + (day.day >= 6 ? '#f8fafc' : '#ffffff') + ';padding:' + pad + '"></td>';
          const hasC = list.some(e => conflictSet.has(e.id));
          const bg = hasC ? '#fef2f2' : day.day >= 6 ? '#f8fafc' : '#ffffff';
          const text = list.map(e => getDisplayLines(e, scope, teachers).map(esc).join('<br>')).join('<hr>');
          return '<td style="border:1px solid #cbd5e1;background:' + bg + ';padding:' + pad + ';font-size:' + font + ';vertical-align:top">' + text + '</td>';
        }).join('');
        rows += '<tr><td style="border:1px solid #cbd5e1;background:#f8fafc;padding:' + pad + '"><b>' + esc(p.name) + '</b><br>' + esc(p.startTime + '-' + p.endTime) + '</td>' + cells + '</tr>';
      }
      tables += '<h3>' + esc(cls.name) + '</h3><table style="border-collapse:collapse;margin-bottom:18px">' + rows + '</table>';
    }
    const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>@page{size:landscape;margin:10mm}td,th{mso-number-format:"\@";}</style></head><body>' + tables + '</body></html>';
    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'zhixing-timetable-wysiwyg.xls';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function renderTimetableTab(d) {
    const scope = d.scope;
    const teachers = d.teachers || [];
    const conflicts = d.conflicts || [];
    const conflictSet = new Set(conflicts.filter(c => c.hard.length).map(c => c.entryId));
    const toolbar = '<section class="panel panel-pad" style="margin-bottom:16px"><div class="row-between wrap" style="gap:10px">' +
      '<div class="row wrap" style="gap:8px">' +
      renderOptionsDropdown() +
      '<button type="button" class="btn btn-primary btn-sm" data-sched-action="auto-schedule">⚡ 一键智能排课</button>' +
      '<button type="button" class="btn btn-soft btn-sm" data-sched-action="publish-schedule">📢 发布同步给师生</button>' +
      '<button type="button" class="btn btn-light btn-sm" data-sched-action="export-wysiwyg">⬇ 导出全校总课表 (Excel)</button>' +
      '<a class="btn btn-light btn-sm" href="/api/admin/schedule/export" download="zhixing-timetable.csv">⬇ CSV</a>' +
      '<button type="button" class="btn btn-light btn-sm" onclick="window.print()">🖨 打印 / 存PDF</button>' +
      '<button type="button" class="btn btn-light btn-sm" data-sched-action="archive-schedule">📦 保存存档</button>' +
      '</div><div class="tiny muted">' + (scope.published ? '已发布：' + fmtDate(scope.published.publishedAt) : '尚未发布给师生') + ' · 共 ' + scope.entries.length + ' 节课 · 冲突 ' + conflictSet.size + ' 项</div></div></section>';

    const viewPills = '<div class="filter-pills" style="margin-bottom:14px">' +
      [['class', '🏫 班级课表'], ['teacher', '👨‍🏫 教师课表'], ['room', '🏢 教室课表'], ['overview', '📅 全校总览'], ['conflicts', '⚠ 冲突报告 (' + conflicts.length + ')']]
        .map(([k, label]) => '<button type="button" class="' + (schedUI.viewMode === k ? 'active' : '') + '" data-sched-action="view-mode" data-mode="' + k + '">' + label + '</button>').join('') +
      '</div>';

    let bodyHtml = '';
    if (schedUI.viewMode === 'class') {
      const sel = '<div class="row wrap" style="margin-bottom:12px"><label class="small"><strong>选择班级：</strong></label><select data-sched-select="class">' +
        (scope.classes.length ? scope.classes.map(c => '<option value="' + esc(c.id) + '"' + (schedUI.selectedClassId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') : '<option value="">请先在基础数据中添加班级</option>') +
        '</select><span class="tiny muted">提示：可直接拖拽两节课互换位置，系统自动校验冲突</span></div>';
      const list = scope.entries.filter(e => e.classId === schedUI.selectedClassId);
      bodyHtml = sel + renderTimetableGrid(scope, teachers, list, 'class', schedUI.selectedClassId, conflictSet);
    } else if (schedUI.viewMode === 'teacher') {
      const sel = '<div class="row wrap" style="margin-bottom:12px"><label class="small"><strong>选择教师：</strong></label><select data-sched-select="teacher">' +
        (teachers.length ? teachers.map(t => '<option value="' + esc(t.id) + '"' + (schedUI.selectedTeacherId === t.id ? ' selected' : '') + '>' + esc(t.name) + (t.department ? ' · ' + esc(t.department) : '') + '</option>').join('') : '<option value="">暂无教师</option>') +
        '</select></div>';
      const list = scope.entries.filter(e => e.teacherId === schedUI.selectedTeacherId);
      bodyHtml = sel + renderTimetableGrid(scope, teachers, list, 'teacher', schedUI.selectedTeacherId, conflictSet);
    } else if (schedUI.viewMode === 'room') {
      const sel = '<div class="row wrap" style="margin-bottom:12px"><label class="small"><strong>选择教室：</strong></label><select data-sched-select="room">' +
        (scope.rooms.length ? scope.rooms.map(r => '<option value="' + esc(r.id) + '"' + (schedUI.selectedRoomId === r.id ? ' selected' : '') + '>' + esc(r.name) + ' (' + esc(r.type) + ')</option>').join('') : '<option value="">请先添加教室</option>') +
        '</select></div>';
      const list = scope.entries.filter(e => e.roomId === schedUI.selectedRoomId);
      bodyHtml = sel + renderTimetableGrid(scope, teachers, list, 'room', schedUI.selectedRoomId, conflictSet);
    } else if (schedUI.viewMode === 'overview') {
      bodyHtml = scope.classes.length
        ? scope.classes.map(c => '<div style="margin-bottom:20px"><h3 style="margin:0 0 8px">' + esc(c.name) + '</h3>' +
          renderTimetableGrid(scope, teachers, scope.entries.filter(e => e.classId === c.id), 'class', c.id, conflictSet) + '</div>').join('')
        : em('暂无班级数据', '请先到“基础数据管理”添加年级、班级、科目与授课计划。');
    } else {
      bodyHtml = conflicts.length
        ? conflicts.map(c => {
          const cls = scope.classes.find(x => x.id === c.classId)?.name || '';
          const sub = scope.subjects.find(x => x.id === c.subjectId)?.name || '';
          const tch = teachers.find(x => x.id === c.teacherId)?.name || '';
          return '<div class="panel panel-pad" style="margin-bottom:10px;border-left:4px solid ' + (c.hard.length ? '#dc2626' : '#eab308') + '">' +
            '<strong>' + esc(cls) + ' · ' + esc(sub) + ' · ' + esc(tch) + ' (周' + c.day + ' ' + esc(c.periodId) + ')</strong>' +
            c.hard.map(h => '<div class="small" style="color:#b91c1c">🔴 [' + esc(h.code) + '] ' + esc(h.message) + '</div>').join('') +
            c.warnings.map(w => '<div class="small" style="color:#a16207">🟡 [' + esc(w.code) + '] ' + esc(w.message) + '</div>').join('') +
            '</div>';
        }).join('')
        : '<div class="panel panel-pad"><p class="small" style="color:#15803d;margin:0">✅ 当前课表零硬冲突、无规则告警！</p></div>';
    }
    return toolbar + '<section class="panel panel-pad">' + viewPills + bodyHtml + '</section>';
  }

  function renderBaseDataTab(d) {
    const scope = d.scope;
    const teachers = d.teachers || [];
    const students = d.students || [];
    const days = getDayNames(scope.settings.daysPerWeek);
    const tPeriods = (scope.settings.periods || []).filter(p => !p.isBreak);
    const tr = scope.teacherRules[schedUI.selectedRuleTeacherId] || { blockedSlots: [], maxDailyPeriods: 0, preference: 'any' };

    return '<div class="form-grid" style="align-items:start">' +
      // 1. Settings & Grades
      '<section class="panel panel-pad"><h3>1. 学校作息与年级</h3>' +
      '<form id="sched-settings-form"><div class="form-grid">' +
      '<div class="field"><label>学段</label><select name="schoolLevel"><option value="小学"' + (scope.settings.schoolLevel==='小学'?' selected':'') + '>小学</option><option value="初中"' + (scope.settings.schoolLevel==='初中'?' selected':'') + '>初中</option><option value="高中"' + (scope.settings.schoolLevel==='高中'?' selected':'') + '>高中</option><option value="大学/职校"' + (scope.settings.schoolLevel==='大学/职校'?' selected':'') + '>大学/职校</option></select></div>' +
      '<div class="field"><label>每周上课天数</label><select name="daysPerWeek"><option value="5"' + (scope.settings.daysPerWeek===5?' selected':'') + '>5天</option><option value="6"' + (scope.settings.daysPerWeek===6?' selected':'') + '>6天</option></select></div>' +
      '<div class="field"><label>校区名称</label><input name="campusName" value="' + esc(scope.settings.campusName || '主校区') + '"></div></div>' +
      '<button type="submit" class="btn btn-soft btn-sm">保存作息设置</button></form>' +
      '<hr style="margin:14px 0;border:0;border-top:1px solid var(--border)">' +
      '<form id="sched-grade-form"><div class="row wrap"><input name="name" placeholder="年级名 (如 高一)" required style="max-width:160px"><input name="maxWeeklyPeriods" type="number" value="40" min="1" max="60" style="max-width:90px"><button type="submit" class="btn btn-primary btn-sm">+ 添加年级</button></div></form>' +
      '<div class="row wrap" style="gap:6px;margin-top:8px">' + scope.grades.map(g => '<span class="pill blue">' + esc(g.name) + ' <button type="button" data-sched-action="del-grade" data-id="' + esc(g.id) + '" style="border:0;background:none;color:inherit;cursor:pointer">×</button></span>').join('') + '</div></section>' +

      // 2. Classes
      '<section class="panel panel-pad"><h3>2. 班级管理 (行政班/走班)</h3>' +
      '<form id="sched-class-form"><div class="form-grid">' +
      '<div class="field"><label>班级名称 *</label><input name="name" placeholder="如 高一(1)班" required></div>' +
      '<div class="field"><label>所属年级</label><select name="gradeId"><option value="">不限</option>' + scope.grades.map(g => '<option value="' + esc(g.id) + '">' + esc(g.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>类型</label><select name="type"><option value="admin">行政班</option><option value="elective">走班班</option><option value="interest">兴趣班</option></select></div></div>' +
      '<button type="submit" class="btn btn-primary btn-sm">+ 添加班级</button></form>' +
      '<div style="margin-top:10px">' + scope.classes.map(c => '<div class="student-detail-row"><span><strong>' + esc(c.name) + '</strong> (' + esc(c.type) + ') · 学生 ' + (c.studentIds?.length || 0) + ' 人</span>' +
        '<div class="row"><button type="button" class="btn btn-danger btn-sm" data-sched-action="del-class" data-id="' + esc(c.id) + '">删除</button></div></div>').join('') + '</div></section>' +

      // 3. Subjects
      '<section class="panel panel-pad"><h3>3. 科目与连堂规则</h3>' +
      '<form id="sched-subject-form"><div class="form-grid">' +
      '<div class="field"><label>科目名称 *</label><input name="name" placeholder="如 语文 / 数学" required></div>' +
      '<div class="field"><label>类别</label><select name="tier"><option value="major">主课</option><option value="minor">副科</option><option value="public">公共课</option></select></div>' +
      '<div class="field"><label>默认周课时</label><input name="weeklyHours" type="number" value="4" min="1" max="30"></div>' +
      '<div class="field"><label>时段偏好</label><select name="preference"><option value="any">不限</option><option value="morning">上午优先</option><option value="afternoon">下午优先</option></select></div>' +
      '<div class="field"><label>连堂设置</label><select name="consecutiveMode"><option value="none">不连堂</option><option value="allow">允许连堂</option><option value="require">必须连堂(2节)</option></select></div></div>' +
      '<button type="submit" class="btn btn-primary btn-sm">+ 添加科目</button></form>' +
      '<div class="row wrap" style="gap:6px;margin-top:10px">' + scope.subjects.map(s => '<span class="pill blue">' + esc(s.name) + ' (' + s.weeklyHours + '节/周' + (s.consecutiveMode === 'require' ? '·连堂' : '') + ') <button type="button" data-sched-action="del-subject" data-id="' + esc(s.id) + '" style="border:0;background:none;color:inherit;cursor:pointer">×</button></span>').join('') + '</div></section>' +

      // 4. Rooms
      '<section class="panel panel-pad"><h3>4. 教室 / 场地资源</h3>' +
      '<form id="sched-room-form"><div class="row wrap">' +
      '<input name="name" placeholder="如 101教室 / 物理实验室" required style="max-width:190px">' +
      '<select name="type"><option value="normal">普通教室</option><option value="lab">实验室</option><option value="computer">计算机室</option><option value="gym">体育场馆</option></select>' +
      '<input name="capacity" type="number" value="50" min="1" style="max-width:80px">' +
      '<button type="submit" class="btn btn-primary btn-sm">+ 添加教室</button></div></form>' +
      '<div class="row wrap" style="gap:6px;margin-top:10px">' + scope.rooms.map(r => '<span class="pill blue">' + esc(r.name) + ' (' + r.capacity + '座) <button type="button" data-sched-action="del-room" data-id="' + esc(r.id) + '" style="border:0;background:none;color:inherit;cursor:pointer">×</button></span>').join('') + '</div></section>' +
      '</div>' +

      // 5. Teaching Plans (Class + Subject + Teacher + Room + Hours + Fixed)
      '<section class="panel panel-pad" style="margin-top:16px"><h3>5. 授课分配计划（教师-班级-科目匹配）</h3>' +
      '<form id="sched-plan-form"><div class="form-grid">' +
      '<div class="field"><label>班级 *</label><select name="classId" required>' + scope.classes.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>科目 *</label><select name="subjectId" required>' + scope.subjects.map(s => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>任课教师 *</label><select name="teacherId" required>' + teachers.map(t => '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>教室 (可选)</label><select name="roomId"><option value="">不指定</option>' + scope.rooms.map(r => '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>周课时 *</label><input name="weeklyHours" type="number" value="4" min="1" max="30" required></div>' +
      '<div class="field"><label style="display:flex;align-items:center;gap:6px;margin-top:26px"><input type="checkbox" name="fixed" value="1"> 固定优先排课</label></div></div>' +
      '<button type="submit" class="btn btn-primary btn-sm">+ 添加授课计划</button></form>' +
      '<div style="margin-top:12px">' + (scope.plans.length ? scope.plans.map(p => {
        const cls = scope.classes.find(c => c.id === p.classId)?.name || '';
        const sub = scope.subjects.find(s => s.id === p.subjectId)?.name || '';
        const tch = teachers.find(t => t.id === p.teacherId)?.name || '';
        const rm = scope.rooms.find(r => r.id === p.roomId)?.name || '';
        return '<div class="student-detail-row"><span><strong>' + esc(cls) + '</strong> · ' + esc(sub) + ' · ' + esc(tch) + (rm ? ' · ' + esc(rm) : '') + ' · <b>' + p.weeklyHours + '节/周</b>' + (p.fixed ? ' <span class="pill blue">固定优先</span>' : '') + '</span>' +
          '<button type="button" class="btn btn-danger btn-sm" data-sched-action="del-plan" data-id="' + esc(p.id) + '">移除</button></div>';
      }).join('') : '<p class="small muted">尚未添加授课分配计划。</p>') + '</div></section>' +

      // 6. Teacher Availability & Constraints
      '<section class="panel panel-pad" style="margin-top:16px"><h3>6. 教师不可排时段与单日上限</h3>' +
      '<div class="row wrap" style="margin-bottom:10px"><label class="small">选择教师：</label><select data-sched-select="rule-teacher">' +
      teachers.map(t => '<option value="' + esc(t.id) + '"' + (schedUI.selectedRuleTeacherId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') +
      '</select></div>' +
      (schedUI.selectedRuleTeacherId ? '<form id="sched-teacher-rule-form"><div class="form-grid">' +
        '<div class="field"><label>单日排课上限 (0为不限)</label><input name="maxDailyPeriods" type="number" min="0" max="15" value="' + n(tr.maxDailyPeriods) + '"></div>' +
        '<div class="field"><label>时段偏好</label><select name="preference"><option value="any"' + (tr.preference==='any'?' selected':'') + '>不限</option><option value="morning"' + (tr.preference==='morning'?' selected':'') + '>上午优先</option><option value="afternoon"' + (tr.preference==='afternoon'?' selected':'') + '>下午优先</option></select></div></div>' +
        '<p class="small muted">勾选固定不可排时段（例如教研会、调休，系统绝对不排课）：</p>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>节次</th>' + days.map(d => '<th>' + d.label + '</th>').join('') + '</tr></thead><tbody>' +
        tPeriods.map(p => '<tr><td>' + esc(p.name) + '</td>' + days.map(d => {
          const k = d.day + '-' + p.id;
          const checked = (tr.blockedSlots || []).includes(k) ? ' checked' : '';
          return '<td style="text-align:center"><input type="checkbox" name="blockedSlots" value="' + k + '"' + checked + '></td>';
        }).join('') + '</tr>').join('') +
        '</tbody></table></div><button type="submit" class="btn btn-primary btn-sm" style="margin-top:10px">保存教师时间规则</button></form>' : '') +
      '</section>' +
      '<section class="panel panel-pad" style="margin-top:16px"><h3>7. 教师组固定无课时间（教研活动 / 集体会议）</h3>' +
      '<p class="small muted">按教研组/部门批量预留活动时段，智能排课与手动调课自动避让。</p>' +
      '<form id="sched-teacher-group-form" style="margin-bottom:14px"><div class="form-grid">' +
      '<div class="field"><label>教师组名称 *</label><input name="name" placeholder="如 语文教研组 / 行政组" required></div>' +
      '<div class="field"><label>勾选组成员（支持一人多组）</label><div style="display:flex;flex-wrap:wrap;gap:8px;padding:8px;border:1px solid var(--border);border-radius:8px">' +
      (teachers.length ? teachers.map(t => '<label style="font-size:12px;display:flex;align-items:center;gap:4px"><input type="checkbox" name="teacherIds" value="' + esc(t.id) + '"><span>' + esc(t.name) + '</span></label>').join('') : '<span class="tiny muted">暂无教师</span>') +
      '</div></div></div><button type="submit" class="btn btn-soft btn-sm">+ 创建教师组</button></form>' +
      '<div class="row wrap" style="gap:6px;margin-bottom:14px">' + (scope.teacherGroups || []).map(g => '<span class="pill blue">' + esc(g.name) + ' (' + (g.teacherIds?.length || 0) + '人) <button type="button" data-sched-action="del-tgroup" data-id="' + esc(g.id) + '" style="border:0;background:none;color:inherit;cursor:pointer">×</button></span>').join('') + '</div>' +
      ((scope.teacherGroups || []).length ? '<form id="sched-group-block-form"><div class="form-grid">' +
        '<div class="field"><label>目标教师组 *</label><select name="groupId" required>' + scope.teacherGroups.map(g => '<option value="' + esc(g.id) + '">' + esc(g.name) + '</option>').join('') + '</select></div>' +
        '<div class="field"><label>周期</label><select name="cycle"><option value="weekly">每周</option><option value="odd">单周</option><option value="even">双周</option><option value="custom">指定周次</option></select></div>' +
        '<div class="field"><label>星期</label><select name="day">' + days.map(dx => '<option value="' + dx.day + '">' + dx.label + '</option>').join('') + '</select></div>' +
        '<div class="field"><label>活动类型</label><select name="activityType"><option value="教研活动">教研活动</option><option value="集体会议">集体会议</option><option value="部门培训">部门培训</option><option value="行政例会">行政例会</option></select></div>' +
        '<div class="field"><label>自定义名称/标签</label><input name="label" placeholder="如 语文组教研"></div>' +
        '<div class="field"><label>背景色 / 图标</label><div class="row"><input name="color" type="color" value="#fef3c7" style="width:52px;padding:2px"><input name="icon" value="🔔" maxlength="4" style="width:60px"></div></div></div>' +
        '<div class="field"><label>选择节次（可多选）*</label><div class="row wrap" style="gap:10px">' + tPeriods.map(tp => '<label style="font-size:13px;display:flex;align-items:center;gap:4px"><input type="checkbox" name="periodIds" value="' + esc(tp.id) + '"><span>' + esc(tp.name) + '</span></label>').join('') + '</div></div>' +
        '<button type="submit" class="btn btn-primary btn-sm">+ 添加教师组固定无课时间</button></form>' : '') +
      '<div style="margin-top:12px">' + ((scope.groupBlocks || []).map(gb => {
        const grp = (scope.teacherGroups || []).find(g => g.id === gb.groupId);
        return '<div class="student-detail-row"><span><span style="padding:2px 7px;border-radius:6px;background:' + esc(gb.color || '#fef3c7') + '">' + esc(gb.icon || '🔔') + ' ' + esc(gb.label) + '</span> · <strong>' + esc(grp?.name || '') + '</strong> · 周' + gb.day + ' (' + (gb.periodIds || []).join(',') + ') · ' + (gb.active === false ? '已暂停' : '生效中') + '</span>' +
          '<div class="row"><button type="button" class="btn btn-light btn-sm" data-sched-action="toggle-gblock" data-id="' + esc(gb.id) + '">' + (gb.active === false ? '启用' : '暂停') + '</button><button type="button" class="btn btn-danger btn-sm" data-sched-action="del-gblock" data-id="' + esc(gb.id) + '">删除</button></div></div>';
      }).join('') || '<p class="small muted">尚未设置教师组固定无课时间。</p>') + '</div></section>';
  }

  function renderApprovalsTab(d) {
    const scope = d.scope;
    const teachers = d.teachers || [];
    const reqs = scope.swapRequests || [];
    const logs = scope.auditLogs || [];
    const reqHtml = '<section class="panel panel-pad" style="margin-bottom:20px"><h3>调课 / 代课审批队列</h3>' +
      (reqs.length ? reqs.map(r => {
        const subTch = r.substituteTeacherId ? (teachers.find(t => t.id === r.substituteTeacherId)?.name || r.substituteTeacherId) : '';
        return '<div class="student-detail-row" style="align-items:flex-start"><div><strong>' + esc(r.requesterName) + '</strong> · <span class="pill ' + (r.status==='approved'?'green':r.status==='rejected'?'gray':'blue') + '">' + esc(r.status) + '</span>' +
          '<div class="small muted">原因：' + esc(r.reason) + (subTch ? ' · 拟代课：' + esc(subTch) : '') + (r.targetDay ? ' · 拟调至周' + r.targetDay + ' ' + esc(r.targetPeriodId) : '') + '</div></div>' +
          (r.status === 'pending' ? '<div class="row"><button type="button" class="btn btn-primary btn-sm" data-sched-action="approve-swap" data-id="' + esc(r.id) + '">同意并更新课表</button><button type="button" class="btn btn-danger btn-sm" data-sched-action="reject-swap" data-id="' + esc(r.id) + '">驳回</button></div>' : '<span class="tiny muted">' + esc(r.reviewerName || '') + '</span>') +
          '</div>';
      }).join('') : '<p class="small muted">暂无调课申请。</p>') + '</section>';
    const logsHtml = '<section class="panel panel-pad"><h3>课表变更留痕日志</h3>' +
      (logs.length ? logs.slice(0, 40).map(l => '<div class="activity-row"><span class="activity-dot"></span><div><strong>' + esc(l.action) + '</strong> · ' + esc(l.actorName) + '<div class="small muted">' + esc(l.detail) + (l.reason ? '（原因：' + esc(l.reason) + '）' : '') + '</div><small>' + fmtDate(l.createdAt) + '</small></div></div>').join('') : '<p class="small muted">暂无变更记录。</p>') +
      '</section>';
    return reqHtml + logsHtml;
  }


  function dFallbackSubj(name) {
    return (schedUI.data?.scope?.subjects || []).find(s => s.name === name);
  }
  function renderCombinedTab(d) {
    const scope = d.scope;
    const teachers = d.teachers || [];
    const groupedIds = new Set((scope.combinedGroups || []).flatMap(g => g.planIds || []));
    const availablePlans = (scope.plans || []).filter(pl => !groupedIds.has(pl.id));
    const planCheckboxes = availablePlans.length
      ? availablePlans.map(pl => {
          const cls = scope.classes.find(c => c.id === pl.classId)?.name || '';
          const sub = scope.subjects.find(s => s.id === pl.subjectId)?.name || '';
          const tch = teachers.find(t => t.id === pl.teacherId)?.name || '';
          return '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:13px"><input type="checkbox" name="planIds" value="' + esc(pl.id) + '"><span><strong>' + esc(cls) + '</strong> · ' + esc(sub) + ' · ' + esc(tch) + ' (' + pl.weeklyHours + '节/周)</span></label>';
        }).join('')
      : '<p class="small muted">暂无可合并的独立授课计划（请先在“基础数据”添加同一老师、同一科目的多班计划）。</p>';

    const formHtml = '<section class="panel panel-pad" style="margin-bottom:20px"><h3>合班设置（同师同科多班合并）</h3>' +
      '<p class="small muted">勾选同一位教师、同一科目的多个班级计划，合并后自动排课与拖拽调课将跨班联动同步。</p>' +
      '<form id="sched-combined-form"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin-bottom:12px">' + planCheckboxes + '</div>' +
      '<div class="form-grid"><div class="field"><label>合班简称 (可选)</label><input name="shortName" placeholder="留空自动生成，如 高一1+2班 / 通用技术"></div>' +
      '<div class="field"><label>指定合班教室 (如阶梯教室)</label><select name="roomId"><option value="">沿用原教室</option>' + scope.rooms.map(r => '<option value="' + esc(r.id) + '">' + esc(r.name) + ' (' + r.capacity + '座)</option>').join('') + '</select></div></div>' +
      '<button type="submit" class="btn btn-primary btn-sm">合并为合班课</button></form></section>';

    const listHtml = '<section class="panel panel-pad"><h3>已创建的合班课 (' + (scope.combinedGroups || []).length + ')</h3>' +
      ((scope.combinedGroups || []).length ? scope.combinedGroups.map(g => {
        const tch = teachers.find(t => t.id === g.teacherId)?.name || '';
        const rm = scope.rooms.find(r => r.id === g.roomId)?.name || '';
        return '<div class="student-detail-row"><span><strong>' + esc(g.shortName) + '</strong> · ' + esc(tch) + (rm ? ' · ' + esc(rm) : '') + ' · ' + g.weeklyHours + '节/周</span>' +
          '<button type="button" class="btn btn-danger btn-sm" data-sched-action="del-combined" data-id="' + esc(g.id) + '">解除合班</button></div>';
      }).join('') : '<p class="small muted">尚未设置合班课程。</p>') + '</section>';
    return formHtml + listHtml;
  }

  function renderPlacementTab(d) {
    const pl = d.scope.placement || { students: [], config: {}, result: null };
    const cfg = pl.config || {};
    const importHtml = '<section class="panel panel-pad" style="margin-bottom:16px"><div class="row-between wrap"><div><h3>1. 导入新生名单</h3>' +
      '<p class="small muted">支持性别、总分/单科成绩、名次、特长标签，以及双胞胎绑定组与同名互斥组。当前已导入：<strong>' + (pl.students?.length || 0) + '</strong> 人</p></div>' +
      '<a class="btn btn-light btn-sm" href="/api/admin/schedule/placement/template" download="student-placement-template.csv">⬇ 下载新生分班模板 (.csv)</a></div>' +
      '<form id="sched-placement-import-form" style="margin-top:10px"><div class="row wrap"><input id="placement-csv-file" type="file" accept=".csv,text/csv" required><button type="submit" class="btn btn-soft btn-sm">导入新生名单</button></div></form></section>';

    const configHtml = '<section class="panel panel-pad" style="margin-bottom:16px"><h3>2. 设置均衡分班规则</h3>' +
      '<form id="sched-placement-preview-form"><div class="form-grid">' +
      '<div class="field"><label>目标班级数量</label><input name="classCount" type="number" min="1" max="50" value="' + n(cfg.classCount || 2) + '" required></div>' +
      '<div class="field"><label>班级名称前缀</label><input name="classPrefix" value="' + esc(cfg.classPrefix || '新生') + '" required></div>' +
      '<div class="field"><label>成绩均衡模式</label><select name="mode"><option value="total"' + (cfg.mode==='total'?' selected':'') + '>总分均衡模式</option><option value="subjects"' + (cfg.mode==='subjects'?' selected':'') + '>多科均衡(语数英+总分)</option><option value="rankBand"' + (cfg.mode==='rankBand'?' selected':'') + '>名次分段均衡</option><option value="percentTier"' + (cfg.mode==='percentTier'?' selected':'') + '>百分比分层均衡</option></select></div>' +
      '<div class="field"><label style="display:flex;align-items:center;gap:6px;margin-top:26px"><input type="checkbox" name="genderBalance" value="1"' + (cfg.genderBalance !== false ? ' checked' : '') + '> 启用男女生人数均衡</label></div></div>' +
      '<button type="submit" class="btn btn-primary btn-sm">⚡ 生成分班预览</button></form></section>';

    const res = pl.result;
    const resHtml = res ? '<section class="panel panel-pad"><div class="row-between wrap" style="margin-bottom:12px"><div><h3>3. 分班均衡度预览 (' + res.length + ' 个班)</h3><p class="small muted">已自动执行双胞胎绑定、互斥拆分与特长分散均衡。</p></div>' +
      '<div class="row wrap"><button type="button" class="btn btn-primary btn-sm" data-sched-action="commit-placement">✅ 确认生成正式行政班</button>' +
      '<a class="btn btn-light btn-sm" href="/api/admin/schedule/placement/export" download="placement-roster.csv">⬇ 导出分班名册 (.csv)</a></div></div>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>班级</th><th>总人数</th><th>男 / 女</th><th>总分均分</th><th>语 / 数 / 英均分</th><th>特长分布</th></tr></thead><tbody>' +
      res.map(c => '<tr><td><strong>' + esc(c.name) + '</strong></td><td>' + c.count + '</td><td>' + c.male + ' / ' + c.female + '</td><td>' + c.avgTotal + '</td><td>' + c.avgChinese + ' / ' + c.avgMath + ' / ' + c.avgEnglish + '</td><td>' + esc(Object.entries(c.tagCounts || {}).map(([k, v]) => k + ':' + v).join(' ') || '—') + '</td></tr>').join('') +
      '</tbody></table></div></section>' : '';

    return importHtml + configHtml + resHtml;
  }

  function renderExamsTab(d) {
    const scope = d.scope;
    const teachers = d.teachers || [];
    const exams = scope.exams || [];
    const activeExam = exams.find(ex => ex.id === schedUI.selectedExamId) || exams[0] || null;

    const createHtml = '<section class="panel panel-pad" style="margin-bottom:16px"><h3>新建考试与监考规则</h3>' +
      '<form id="sched-exam-create-form"><div class="form-grid">' +
      '<div class="field"><label>考试名称 *</label><input name="name" placeholder="如 2026秋期中考试" required></div>' +
      '<div class="field"><label>每场每考场监考人数</label><select name="proctorsPerRoom"><option value="1">1人</option><option value="2">2人</option></select></div>' +
      '<div class="field"><label>所教班级规则</label><select name="taughtClass"><option value="avoid">尽量避免监考自己任教班级</option><option value="any">无所谓</option><option value="prefer">优先安排一位任教教师</option></select></div>' +
      '<div class="field"><label>所教课程规则</label><select name="taughtSubject"><option value="avoid">尽量避免监考自己所教科目</option><option value="any">无所谓</option><option value="prefer">优先安排一位任课教师</option></select></div></div>' +
      '<div class="form-grid"><div class="field"><label>考试场次（每行一场：场次名,时间段,科目名称）</label><textarea name="slotsText" rows="2" placeholder="第一场 上午,08:30-10:30,数学&#10;第二场 下午,14:00-16:00,英语" required>第一场 上午,08:30-10:30,语文&#10;第二场 下午,14:00-16:00,数学</textarea></div>' +
      '<div class="field"><label>考场列表（逗号分隔，可直接填班级或教室名）</label><textarea name="roomsText" rows="2" required>' + esc(scope.classes.length ? scope.classes.map(c => c.name).join(',') : '第1考场,第2考场') + '</textarea></div></div>' +
      '<button type="submit" class="btn btn-primary btn-sm">+ 创建考试计划</button></form></section>';

    let detailHtml = '';
    if (activeExam) {
      const viewPills = '<div class="filter-pills" style="margin:12px 0">' +
        [['plan', '📅 按考试计划'], ['teacher', '👨‍🏫 按监考教师'], ['room', '🏫 按考场']]
          .map(([k, label]) => '<button type="button" class="' + (schedUI.examView === k ? 'active' : '') + '" data-sched-action="exam-view" data-mode="' + k + '">' + label + '</button>').join('') +
        '</div>';
      const asgs = activeExam.assignments || [];
      let matrixHtml = '';
      if (!asgs.length) {
        matrixHtml = '<p class="small muted">点击下方“自动排监考”即可按规则避开上课时间冲突并均衡分配监考老师。</p>';
      } else if (schedUI.examView === 'plan') {
        matrixHtml = '<div class="table-wrap"><table class="data-table"><thead><tr><th>场次 / 科目</th>' + activeExam.rooms.map(r => '<th>' + esc(r.name) + '</th>').join('') + '</tr></thead><tbody>' +
          activeExam.slots.map(sl => '<tr><td><strong>' + esc(sl.dateLabel) + '</strong><br><span class="tiny muted">' + esc(sl.startTime + '-' + sl.endTime + ' · ' + sl.subjectName) + '</span></td>' +
            activeExam.rooms.map(rm => {
              const a = asgs.find(x => x.slotId === sl.id && x.roomId === rm.id);
              const names = (a?.teacherIds || []).map(tid => teachers.find(t => t.id === tid)?.name || tid).join('、') || '未分配';
              return '<td><strong>' + esc(names) + '</strong>' + (a?.warnings?.length ? '<div class="tiny" style="color:#b91c1c">' + esc(a.warnings[0]) + '</div>' : '') + '</td>';
            }).join('') + '</tr>').join('') +
          '</tbody></table></div>';
      } else if (schedUI.examView === 'teacher') {
        const byTeacher = new Map();
        for (const a of asgs) {
          const sl = activeExam.slots.find(s => s.id === a.slotId);
          const rm = activeExam.rooms.find(r => r.id === a.roomId);
          for (const tid of (a.teacherIds || [])) {
            if (!byTeacher.has(tid)) byTeacher.set(tid, []);
            byTeacher.get(tid).push(`${sl?.dateLabel || ''} (${sl?.subjectName || ''}) → ${rm?.name || ''}`);
          }
        }
        matrixHtml = [...byTeacher.entries()].map(([tid, list]) => {
          const tName = teachers.find(t => t.id === tid)?.name || tid;
          return '<div class="student-detail-row"><span><strong>' + esc(tName) + '</strong> (共 ' + list.length + ' 场)</span><span class="small muted">' + esc(list.join(' | ')) + '</span></div>';
        }).join('');
      } else {
        matrixHtml = activeExam.rooms.map(rm => {
          const list = asgs.filter(a => a.roomId === rm.id).map(a => {
            const sl = activeExam.slots.find(s => s.id === a.slotId);
            const names = (a.teacherIds || []).map(tid => teachers.find(t => t.id === tid)?.name || tid).join('、');
            return `${sl?.dateLabel || ''} ${sl?.subjectName || ''}: ${names}`;
          });
          return '<div class="student-detail-row"><span><strong>' + esc(rm.name) + '</strong></span><span class="small muted">' + esc(list.join(' | ')) + '</span></div>';
        }).join('');
      }

      detailHtml = '<section class="panel panel-pad"><div class="row-between wrap"><div><h3>' + esc(activeExam.name) + '</h3>' +
        '<p class="small muted">规则：所教班级(' + esc(activeExam.rules?.taughtClass) + ') · 所教课程(' + esc(activeExam.rules?.taughtSubject) + ')</p></div>' +
        '<div class="row wrap">' +
        (exams.length > 1 ? '<select data-sched-select="exam">' + exams.map(ex => '<option value="' + esc(ex.id) + '"' + (ex.id === activeExam.id ? ' selected' : '') + '>' + esc(ex.name) + '</option>').join('') + '</select>' : '') +
        '<button type="button" class="btn btn-primary btn-sm" data-sched-action="auto-proctor" data-id="' + esc(activeExam.id) + '">⚡ 自动排监考</button>' +
        '<a class="btn btn-light btn-sm" href="/api/admin/schedule/exams/' + encodeURIComponent(activeExam.id) + '/export" download="exam-proctoring.csv">⬇ 导出监考表 (.csv)</a>' +
        '<button type="button" class="btn btn-light btn-sm" onclick="window.print()">🖨 打印</button>' +
        '<button type="button" class="btn btn-danger btn-sm" data-sched-action="del-exam" data-id="' + esc(activeExam.id) + '">删除</button>' +
        '</div></div>' + viewPills + matrixHtml + '</section>';
    }
    return createHtml + detailHtml;
  }

  function renderAdminScheduleWorkspace() {
    if (!schedUI.data && !schedUI.error) {
      loadAdminSchedule();
      return '<section class="panel panel-pad">正在加载智能排课工作台…</section>';
    }
    if (schedUI.error) {
      return '<section class="panel panel-pad"><p class="form-error">' + esc(schedUI.error) + '</p><button class="btn btn-soft" data-sched-action="reload">重试</button></section>';
    }
    const d = schedUI.data;
    const pendingCount = (d.scope.swapRequests || []).filter(r => r.status === 'pending').length;
    const subNav = '<div class="tabs" style="margin-bottom:16px">' +
      '<button type="button" class="tab ' + (schedUI.subTab === 'timetable' ? 'active' : '') + '" data-sched-action="subtab" data-tab="timetable">📅 智能排课与课表视图</button>' +
      '<button type="button" class="tab ' + (schedUI.subTab === 'basedata' ? 'active' : '') + '" data-sched-action="subtab" data-tab="basedata">⚙ 基础数据与约束设置</button>' +
      '<button type="button" class="tab ' + (schedUI.subTab === 'combined' ? 'active' : '') + '" data-sched-action="subtab" data-tab="combined">🔗 合班设置</button>' +
      '<button type="button" class="tab ' + (schedUI.subTab === 'placement' ? 'active' : '') + '" data-sched-action="subtab" data-tab="placement">🎓 智能分班</button>' +
      '<button type="button" class="tab ' + (schedUI.subTab === 'exams' ? 'active' : '') + '" data-sched-action="subtab" data-tab="exams">📝 监考安排</button>' +
      '<button type="button" class="tab ' + (schedUI.subTab === 'approvals' ? 'active' : '') + '" data-sched-action="subtab" data-tab="approvals">📝 调课审批与日志' + (pendingCount ? ' (' + pendingCount + ')' : '') + '</button>' +
      '</div>';
    const content = schedUI.subTab === 'timetable' ? renderTimetableTab(d) : schedUI.subTab === 'basedata' ? renderBaseDataTab(d) : schedUI.subTab === 'combined' ? renderCombinedTab(d) : schedUI.subTab === 'placement' ? renderPlacementTab(d) : schedUI.subTab === 'exams' ? renderExamsTab(d) : renderApprovalsTab(d);
    return subNav + content + renderAddSlotModal(d) + renderConflictModal();
  }

  function renderAddSlotModal(d) {
    if (!schedUI.addSlot) return '';
    const scope = d.scope;
    const teachers = d.teachers || [];
    return '<div class="modal-backdrop" data-sched-action="close-add-slot"><div class="modal"><div class="modal-head"><h2>手动排课 (周' + schedUI.addSlot.day + ' ' + esc(schedUI.addSlot.periodId) + ')</h2>' +
      '<button class="icon-btn" type="button" data-sched-action="close-add-slot">✕</button></div>' +
      '<form id="sched-manual-entry-form"><div class="modal-body">' +
      '<div class="field"><label>班级</label><select name="classId" required>' + scope.classes.map(c => '<option value="' + esc(c.id) + '"' + (schedUI.selectedClassId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>科目</label><select name="subjectId" required>' + scope.subjects.map(s => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>教师</label><select name="teacherId" required>' + teachers.map(t => '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>教室 (可选)</label><select name="roomId"><option value="">不指定</option>' + scope.rooms.map(r => '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>').join('') + '</select></div>' +
      '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="locked" value="1"> 锁定此课程（不被自动排课覆盖）</label>' +
      '</div><div class="modal-actions"><button type="button" class="btn btn-light" data-sched-action="close-add-slot">取消</button><button type="submit" class="btn btn-primary">确认排课</button></div></form></div></div>';
  }

  function renderConflictModal() {
    if (!schedUI.conflictModal) return '';
    const m = schedUI.conflictModal;
    return '<div class="modal-backdrop" data-sched-action="close-conflict"><div class="modal"><div class="modal-head"><h2 style="color:#dc2626">⚠ 检测到排课硬冲突</h2>' +
      '<button class="icon-btn" type="button" data-sched-action="close-conflict">✕</button></div><div class="modal-body">' +
      (m.hard || []).map(h => '<p class="form-error">🔴 ' + esc(h.message) + '</p>').join('') +
      (m.alternatives?.length ? '<p class="small"><strong>推荐可用空白时段：</strong></p><div class="row wrap" style="gap:6px;margin-bottom:12px">' +
        m.alternatives.map(a => '<button type="button" class="btn btn-soft btn-sm" data-sched-action="use-alt" data-day="' + a.day + '" data-period="' + esc(a.periodId) + '">周' + a.day + ' ' + esc(a.periodName) + '</button>').join('') + '</div>' : '') +
      '<form id="sched-force-form"><div class="field"><label>超级管理员强制放行原因（留痕记录）</label><input name="overrideReason" placeholder="如：临时合班/紧急活动调课" required></div>' +
      '<button type="submit" class="btn btn-danger btn-sm">强制放行并记录日志</button></form>' +
      '</div></div></div>';
  }

  function renderMyTimetablePage() {
    if (!schedUI.myData && !schedUI.myLoading) {
      loadMyTimetable();
      return '<section class="panel panel-pad">正在加载个人课表…</section>';
    }
    const d = schedUI.myData;
    if (!d || !d.published) {
      return '<div class="page-head"><div><div class="eyebrow">MY TIMETABLE</div><h1>个人课表</h1><p>查看学校正式发布的每周课程安排。</p></div></div>' +
        em('学校尚未发布正式课表', '管理员发布课表后，您的每周课表将自动同步到这里。');
    }
    const days = getDayNames(d.daysPerWeek);
    const periods = d.periods || [];
    const isTeacher = state.user?.role === 'teacher';
    const header = '<tr><th style="width:110px">节次 / 时间</th>' + days.map(x => '<th>' + x.label + '</th>').join('') + '</tr>';
    const rows = periods.map(p => {
      if (p.isBreak) return '<tr style="background:#f3f4f6"><td colspan="' + (days.length + 1) + '" style="text-align:center;color:#6b7280;font-size:12px;padding:6px"><strong>' + esc(p.name) + '</strong> (' + esc(p.startTime) + '–' + esc(p.endTime) + ')</td></tr>';
      const cells = days.map(day => {
        const list = d.entries.filter(e => Number(e.day) === day.day && e.periodId === p.id);
        const acts = isTeacher ? (d.groupActivities || []).filter(gb => Number(gb.day) === day.day && (gb.periodIds || []).includes(p.id)) : [];
        const actHtml = acts.map(gb => '<div style="padding:5px 7px;border-radius:6px;background:' + esc(gb.color || '#fef3c7') + ';font-size:12px;margin-bottom:4px"><strong>' + esc(gb.icon || '🔔') + ' ' + esc(gb.label || gb.activityType) + '</strong><div class="tiny muted">' + esc(gb.groupName || '') + '</div></div>').join('');
        return '<td>' + ((list.length || actHtml) ? actHtml + list.map(e => '<div style="padding:6px;border-radius:8px;border:1px solid var(--border);background:#fff"><strong>' + esc(e.subjectName) + '</strong><div class="tiny muted">' + esc(e.className) + (e.teacherName ? ' · ' + esc(e.teacherName) : '') + (e.roomName ? ' · ' + esc(e.roomName) : '') + '</div></div>').join('') : '<span class="tiny muted">' + (isTeacher ? '无课' : '—') + '</span>') + '</td>';
      }).join('');
      return '<tr><td><strong>' + esc(p.name) + '</strong><br><span class="tiny muted">' + esc(p.startTime) + '–' + esc(p.endTime) + '</span></td>' + cells + '</tr>';
    }).join('');
    const reqForm = isTeacher && d.entries.length ? '<section class="panel panel-pad" style="margin-top:20px"><h3>提交调课 / 代课申请</h3><form id="teacher-swap-req-form"><div class="form-grid">' +
      '<div class="field"><label>选择要调整的课程</label><select name="entryId" required>' + d.entries.map(e => '<option value="' + esc(e.id) + '">周' + e.day + ' ' + esc(e.periodId) + ' · ' + esc(e.subjectName) + ' (' + esc(e.className) + ')</option>').join('') + '</select></div>' +
      '<div class="field"><label>拟代课教师 (可选)</label><select name="substituteTeacherId"><option value="">不换教师</option>' + (d.schoolTeachers || []).map(t => '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>拟调至星期 (可选)</label><select name="targetDay"><option value="">不变</option>' + days.map(x => '<option value="' + x.day + '">' + x.label + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>拟调至节次 (可选)</label><select name="targetPeriodId"><option value="">不变</option>' + periods.filter(p => !p.isBreak).map(p => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('') + '</select></div></div>' +
      '<div class="field"><label>申请原因 *</label><input name="reason" placeholder="如：外出教研/病假调课" required></div>' +
      '<button type="submit" class="btn btn-primary btn-sm">提交管理员审批</button></form>' +
      ((d.swapRequests || []).length ? '<div style="margin-top:14px"><strong>我的申请记录</strong>' + d.swapRequests.map(r => '<div class="student-detail-row"><span>' + esc(r.reason) + '</span><span class="pill blue">' + esc(r.status) + '</span></div>').join('') + '</div>' : '') +
      '</section>' : '';
    return '<div class="page-head"><div><div class="eyebrow">PUBLISHED TIMETABLE</div><h1>我的个人课表</h1><p>发布时间：' + fmtDate(d.publishedAt) + '</p></div><button type="button" class="btn btn-light" onclick="window.print()">🖨 打印课表</button></div>' +
      '<section class="panel panel-pad"><div class="table-wrap"><table class="data-table"><thead>' + header + '</thead><tbody>' + rows + '</tbody></table></div></section>' + reqForm;
  }

  window.renderAdminScheduleWorkspace = renderAdminScheduleWorkspace;
  window.renderMyTimetablePage = renderMyTimetablePage;

  // Event delegation for scheduling actions
  document.addEventListener('click', event => {
    const btn = event.target.closest('[data-sched-action]');
    if (!btn) return;
    const act = btn.dataset.schedAction;
    if ((act === 'close-add-slot' || act === 'close-conflict') && btn.classList.contains('modal-backdrop') && event.target !== btn) return;
    event.preventDefault();
    if (act === 'reload') { schedUI.error = ''; schedUI.data = null; render(); return; }
    if (act === 'subtab') { schedUI.subTab = btn.dataset.tab; render(); return; }
    if (act === 'view-mode') { schedUI.viewMode = btn.dataset.mode; render(); return; }
    if (act === 'toggle-options') { schedUI.optionsOpen = !schedUI.optionsOpen; render(); return; }
    if (act === 'export-wysiwyg' && schedUI.data) { exportWysiwygExcel(schedUI.data); showToast('已按当前界面显示模式导出 Excel 课表'); return; }
    if (act === 'open-add-slot') { schedUI.addSlot = { day: Number(btn.dataset.day), periodId: btn.dataset.period }; render(); return; }
    if (act === 'close-add-slot') { schedUI.addSlot = null; render(); return; }
    if (act === 'close-conflict') { schedUI.conflictModal = null; render(); return; }
    if (act === 'use-alt' && schedUI.conflictModal?.candidate) {
      const c = { ...schedUI.conflictModal.candidate, day: Number(btn.dataset.day), periodId: btn.dataset.period };
      run(async () => {
        await api('/api/admin/schedule/entries', { method: 'POST', body: JSON.stringify(c) });
        schedUI.conflictModal = null; schedUI.addSlot = null;
        await refreshAdminSchedule(); showToast('已按推荐时段排课');
      }, '排课失败: ');
      return;
    }
    if (act === 'auto-schedule') {
      run(async () => {
        const res = await api('/api/admin/schedule/auto', { method: 'POST', body: JSON.stringify({}) });
        await refreshAdminSchedule();
        showToast('智能排课完成：已排 ' + res.placedCount + ' 节，未排 ' + (res.unplaced?.length || 0) + ' 项');
      }, '排课失败: ');
      return;
    }
    if (act === 'publish-schedule') {
      run(async () => {
        await api('/api/admin/schedule/publish', { method: 'POST', body: JSON.stringify({}) });
        await refreshAdminSchedule();
        showToast('正式课表已发布并同步给全校师生！');
      }, '发布失败: ');
      return;
    }
    if (act === 'archive-schedule') {
      const name = prompt('请输入存档名称（例如：2026秋第1版）', '课表存档 ' + new Date().toLocaleDateString());
      if (!name) return;
      run(async () => {
        await api('/api/admin/schedule/archive', { method: 'POST', body: JSON.stringify({ name }) });
        await refreshAdminSchedule(); showToast('课表已存档');
      }, '存档失败: ');
      return;
    }
    if (act === 'toggle-lock') {
      run(async () => { await api('/api/admin/schedule/entries/' + encodeURIComponent(btn.dataset.id) + '/lock', { method: 'PATCH', body: JSON.stringify({}) }); await refreshAdminSchedule(); }, '');
      return;
    }
    if (act === 'delete-entry') {
      run(async () => { await api('/api/admin/schedule/entries/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }); await refreshAdminSchedule(); showToast('已删除'); }, '');
      return;
    }
    if (act === 'del-grade' || act === 'del-class' || act === 'del-subject' || act === 'del-room' || act === 'del-plan') {
      const map = { 'del-grade': 'grades', 'del-class': 'classes', 'del-subject': 'subjects', 'del-room': 'rooms', 'del-plan': 'plans' };
      run(async () => { await api('/api/admin/schedule/' + map[act] + '/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }); await refreshAdminSchedule(); }, '删除失败: ');
      return;
    }
    if (act === 'exam-view') { schedUI.examView = btn.dataset.mode; render(); return; }
    if (act === 'del-combined') {
      run(async () => { await api('/api/admin/schedule/combined/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }); await refreshAdminSchedule(); showToast('已解除合班'); }, '操作失败: ');
      return;
    }
    if (act === 'commit-placement') {
      run(async () => { const res = await api('/api/admin/schedule/placement/commit', { method: 'POST', body: JSON.stringify({}) }); await refreshAdminSchedule(); showToast('已正式生成 ' + res.classes.length + ' 个行政班'); }, '生成失败: ');
      return;
    }
    if (act === 'auto-proctor') {
      run(async () => { await api('/api/admin/schedule/exams/' + encodeURIComponent(btn.dataset.id) + '/auto', { method: 'POST', body: JSON.stringify({}) }); await refreshAdminSchedule(); showToast('已完成自动排监考'); }, '排监考失败: ');
      return;
    }
    if (act === 'del-tgroup') {
      run(async () => { await api('/api/admin/schedule/teacher-groups/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }); await refreshAdminSchedule(); showToast('已删除教师组'); }, '操作失败: ');
      return;
    }
    if (act === 'toggle-gblock') {
      run(async () => { await api('/api/admin/schedule/group-blocks/' + encodeURIComponent(btn.dataset.id) + '/toggle', { method: 'PATCH', body: JSON.stringify({}) }); await refreshAdminSchedule(); showToast('状态已更新'); }, '操作失败: ');
      return;
    }
    if (act === 'del-gblock') {
      run(async () => { await api('/api/admin/schedule/group-blocks/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }); await refreshAdminSchedule(); showToast('已删除'); }, '操作失败: ');
      return;
    }
    if (act === 'del-exam') {
      run(async () => { await api('/api/admin/schedule/exams/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }); schedUI.selectedExamId = ''; await refreshAdminSchedule(); showToast('已删除考试计划'); }, '删除失败: ');
      return;
    }
    if (act === 'approve-swap' || act === 'reject-swap') {
      const decision = act === 'approve-swap' ? 'approve' : 'reject';
      run(async () => { await api('/api/admin/schedule/requests/' + encodeURIComponent(btn.dataset.id) + '/review', { method: 'POST', body: JSON.stringify({ decision }) }); await refreshAdminSchedule(); showToast(decision === 'approve' ? '已同意并自动更新课表' : '已驳回'); }, '审批失败: ');
    }
  });

  document.addEventListener('change', event => {
    const prefKey = event.target.dataset?.schedPref;
    if (prefKey) {
      schedUI.prefs[prefKey] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      savePrefs(schedUI.prefs);
      render();
      return;
    }
    const sel = event.target.dataset?.schedSelect;
    if (!sel) return;
    if (sel === 'class') schedUI.selectedClassId = event.target.value;
    else if (sel === 'teacher') schedUI.selectedTeacherId = event.target.value;
    else if (sel === 'room') schedUI.selectedRoomId = event.target.value;
    else if (sel === 'rule-teacher') schedUI.selectedRuleTeacherId = event.target.value;
    else if (sel === 'exam') schedUI.selectedExamId = event.target.value;
    render();
  });

  // Drag & drop swap
  document.addEventListener('dragstart', event => {
    const card = event.target.closest('[data-sched-entry]');
    if (card) schedUI.dragEntryId = card.dataset.schedEntry;
  });
  document.addEventListener('dragover', event => {
    if (event.target.closest('[data-sched-drop]')) event.preventDefault();
  });
  document.addEventListener('drop', event => {
    const targetCard = event.target.closest('[data-sched-entry]');
    if (!schedUI.dragEntryId || !targetCard) return;
    const entryAId = schedUI.dragEntryId;
    const entryBId = targetCard.dataset.schedEntry;
    schedUI.dragEntryId = null;
    if (entryAId === entryBId) return;
    event.preventDefault();
    run(async () => {
      await api('/api/admin/schedule/swap', { method: 'POST', body: JSON.stringify({ entryAId, entryBId }) });
      await refreshAdminSchedule();
      showToast('已互换两节课程');
    }, '无法互换: ');
  });

  document.addEventListener('submit', event => {
    const form = event.target;
    const ids = ['sched-settings-form', 'sched-grade-form', 'sched-class-form', 'sched-subject-form', 'sched-room-form', 'sched-plan-form', 'sched-teacher-rule-form', 'sched-manual-entry-form', 'sched-force-form', 'teacher-swap-req-form', 'sched-combined-form', 'sched-placement-import-form', 'sched-placement-preview-form', 'sched-exam-create-form', 'sched-teacher-group-form', 'sched-group-block-form'];
    if (!ids.includes(form.id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const values = Object.fromEntries(new FormData(form));
    if (form.id === 'sched-settings-form') {
      run(async () => { await api('/api/admin/schedule/settings', { method: 'PUT', body: JSON.stringify(values) }); await refreshAdminSchedule(); showToast('作息设置已保存'); }, '保存失败: ');
    } else if (form.id === 'sched-grade-form') {
      run(async () => { await api('/api/admin/schedule/grades', { method: 'POST', body: JSON.stringify(values) }); await refreshAdminSchedule(); showToast('年级已添加'); }, '添加失败: ');
    } else if (form.id === 'sched-class-form') {
      run(async () => { const res = await api('/api/admin/schedule/classes', { method: 'POST', body: JSON.stringify(values) }); schedUI.selectedClassId = res.cls.id; await refreshAdminSchedule(); showToast('班级已添加'); }, '添加失败: ');
    } else if (form.id === 'sched-subject-form') {
      run(async () => { await api('/api/admin/schedule/subjects', { method: 'POST', body: JSON.stringify(values) }); await refreshAdminSchedule(); showToast('科目已添加'); }, '添加失败: ');
    } else if (form.id === 'sched-room-form') {
      run(async () => { const res = await api('/api/admin/schedule/rooms', { method: 'POST', body: JSON.stringify(values) }); schedUI.selectedRoomId = res.room.id; await refreshAdminSchedule(); showToast('教室已添加'); }, '添加失败: ');
    } else if (form.id === 'sched-plan-form') {
      run(async () => { await api('/api/admin/schedule/plans', { method: 'POST', body: JSON.stringify({ ...values, fixed: form.querySelector('input[name="fixed"]')?.checked }) }); await refreshAdminSchedule(); showToast('授课计划已添加'); }, '添加失败: ');
    } else if (form.id === 'sched-teacher-rule-form') {
      const blockedSlots = [...form.querySelectorAll('input[name="blockedSlots"]:checked')].map(x => x.value);
      run(async () => { await api('/api/admin/schedule/teacher-rules/' + encodeURIComponent(schedUI.selectedRuleTeacherId), { method: 'PUT', body: JSON.stringify({ ...values, blockedSlots }) }); await refreshAdminSchedule(); showToast('教师规则已保存'); }, '保存失败: ');
    } else if (form.id === 'sched-manual-entry-form') {
      const candidate = { ...values, day: schedUI.addSlot.day, periodId: schedUI.addSlot.periodId, locked: form.querySelector('input[name="locked"]')?.checked };
      run(async () => {
        const res = await fetch('/api/admin/schedule/entries', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(candidate) });
        const data = await res.json();
        if (res.status === 409) { schedUI.conflictModal = { ...data, candidate }; render(); return; }
        if (!res.ok) throw new Error(data.error || '排课失败');
        schedUI.addSlot = null; await refreshAdminSchedule(); showToast('排课成功');
      }, '');
    } else if (form.id === 'sched-force-form') {
      const candidate = { ...schedUI.conflictModal.candidate, forceOverride: true, overrideReason: values.overrideReason };
      run(async () => {
        await api('/api/admin/schedule/entries', { method: 'POST', body: JSON.stringify(candidate) });
        schedUI.conflictModal = null; schedUI.addSlot = null; await refreshAdminSchedule(); showToast('已强制放行并记录日志');
      }, '操作失败: ');
    } else if (form.id === 'sched-combined-form') {
      const planIds = [...form.querySelectorAll('input[name="planIds"]:checked')].map(x => x.value);
      run(async () => { await api('/api/admin/schedule/combined', { method: 'POST', body: JSON.stringify({ ...values, planIds }) }); await refreshAdminSchedule(); showToast('合班创建成功'); }, '合班失败: ');
    } else if (form.id === 'sched-placement-import-form') {
      const file = form.querySelector('input[type="file"]')?.files?.[0];
      if (!file) return;
      run(async () => { const csv = await file.text(); const res = await api('/api/admin/schedule/placement/import', { method: 'POST', body: JSON.stringify({ csv }) }); await refreshAdminSchedule(); showToast('已导入 ' + res.count + ' 名新生'); }, '导入失败: ');
    } else if (form.id === 'sched-placement-preview-form') {
      const genderBalance = Boolean(form.querySelector('input[name="genderBalance"]')?.checked);
      run(async () => { await api('/api/admin/schedule/placement/preview', { method: 'POST', body: JSON.stringify({ ...values, genderBalance }) }); await refreshAdminSchedule(); showToast('分班预览已生成'); }, '分班失败: ');
    } else if (form.id === 'sched-exam-create-form') {
      const slots = String(values.slotsText || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
        const [dateLabel, timeRange, subjectName] = line.split(',').map(x => x.trim());
        const [startTime, endTime] = (timeRange || '08:30-10:30').split('-');
        const subj = dFallbackSubj(subjectName);
        return { dateLabel: dateLabel || '第一场', startTime: startTime || '08:30', endTime: endTime || '10:30', subjectName: subjectName || '', subjectId: subj?.id || '' };
      });
      const rooms = String(values.roomsText || '').split(/[,，\n]/).map(x => x.trim()).filter(Boolean).map(name => {
        const cls = (schedUI.data?.scope?.classes || []).find(c => c.name === name);
        return { name, classId: cls?.id || '' };
      });
      run(async () => {
        const res = await api('/api/admin/schedule/exams', { method: 'POST', body: JSON.stringify({ name: values.name, slots, rooms, rules: { taughtClass: values.taughtClass, taughtSubject: values.taughtSubject, proctorsPerRoom: Number(values.proctorsPerRoom || 1) } }) });
        schedUI.selectedExamId = res.exam.id;
        await refreshAdminSchedule();
        showToast('考试计划已创建');
      }, '创建失败: ');
    } else if (form.id === 'sched-teacher-group-form') {
      const teacherIds = [...form.querySelectorAll('input[name="teacherIds"]:checked')].map(x => x.value);
      run(async () => { await api('/api/admin/schedule/teacher-groups', { method: 'POST', body: JSON.stringify({ name: values.name, teacherIds }) }); await refreshAdminSchedule(); showToast('教师组已创建'); }, '创建失败: ');
    } else if (form.id === 'sched-group-block-form') {
      const periodIds = [...form.querySelectorAll('input[name="periodIds"]:checked')].map(x => x.value);
      if (!periodIds.length) { showToast('请至少选择一个节次', true); return; }
      run(async () => { await api('/api/admin/schedule/group-blocks', { method: 'POST', body: JSON.stringify({ ...values, periodIds }) }); await refreshAdminSchedule(); showToast('已设置教师组固定无课时间'); }, '设置失败: ');
    } else if (form.id === 'teacher-swap-req-form') {
      run(async () => {
        await api('/api/teacher/schedule/requests', { method: 'POST', body: JSON.stringify(values) });
        await loadMyTimetable(); showToast('调课申请已提交管理员审批');
      }, '提交失败: ');
    }
  }, true);
})();
