// 51-style Intelligent Course Scheduling Workspace (Admin) & Personal Timetable (Teacher/Student).
(() => {
  const DAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六'];
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
  };

  function getDayNames(days) {
    return Array.from({ length: Number(days || 5) }, (_, i) => ({ day: i + 1, label: DAYS[i + 1] }));
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
    const subj = scope.subjects.find(s => s.id === e.subjectId);
    const cls = scope.classes.find(c => c.id === e.classId);
    const tch = teachers.find(t => t.id === e.teacherId);
    const rm = scope.rooms.find(r => r.id === e.roomId);
    const hasConflict = conflictSet.has(e.id);
    const border = hasConflict ? '2px solid #dc2626' : e.temporary ? '1.5px dashed #3b82f6' : '1px solid var(--border)';
    const bg = hasConflict ? '#fef2f2' : e.locked ? '#f8fafc' : '#fff';
    return '<div draggable="' + (!e.locked) + '" data-sched-entry="' + esc(e.id) + '" style="padding:7px 9px;border-radius:8px;border:' + border + ';background:' + bg + ';cursor:' + (e.locked ? 'default' : 'grab') + ';margin-bottom:4px">' +
      '<div class="row-between" style="gap:4px"><strong style="font-size:13px">' + esc(subj?.name || '课程') + '</strong>' +
      '<span>' + (e.locked ? '🔒' : '') + (e.temporary ? '<span class="pill blue" style="font-size:10px;padding:1px 5px">临时</span>' : '') + (hasConflict ? '<span class="pill" style="background:#fee2e2;color:#b91c1c;font-size:10px;padding:1px 5px">冲突</span>' : '') + '</span></div>' +
      '<div class="tiny muted">' + esc(tch?.name || '') + (cls ? ' · ' + esc(cls.name) : '') + (rm ? ' · ' + esc(rm.name) : '') + '</div>' +
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
        const content = cellEntries.length
          ? cellEntries.map(e => renderCellCard(e, scope, teachers, conflictSet)).join('')
          : '<div class="tiny muted" style="text-align:center;padding:8px 0">' + (filterType === 'teacher' ? '无课' : '<button type="button" class="btn-text" style="font-size:11px" data-sched-action="open-add-slot" data-day="' + d.day + '" data-period="' + esc(p.id) + '">+ 排课</button>') + '</div>';
        return '<td data-sched-drop="1" data-day="' + d.day + '" data-period="' + esc(p.id) + '" style="vertical-align:top;min-width:130px">' + content + '</td>';
      }).join('');
      return '<tr><td><strong>' + esc(p.name) + '</strong><br><span class="tiny muted">' + esc(p.startTime) + '–' + esc(p.endTime) + '</span></td>' + cells + '</tr>';
    }).join('');
    return '<div class="table-wrap"><table class="data-table" style="border-collapse:collapse"><thead>' + header + '</thead><tbody>' + rows + '</tbody></table></div>';
  }

  function renderTimetableTab(d) {
    const scope = d.scope;
    const teachers = d.teachers || [];
    const conflicts = d.conflicts || [];
    const conflictSet = new Set(conflicts.filter(c => c.hard.length).map(c => c.entryId));
    const toolbar = '<section class="panel panel-pad" style="margin-bottom:16px"><div class="row-between wrap" style="gap:10px">' +
      '<div class="row wrap" style="gap:8px">' +
      '<button type="button" class="btn btn-primary btn-sm" data-sched-action="auto-schedule">⚡ 一键智能排课</button>' +
      '<button type="button" class="btn btn-soft btn-sm" data-sched-action="publish-schedule">📢 发布同步给师生</button>' +
      '<a class="btn btn-light btn-sm" href="/api/admin/schedule/export" download="zhixing-timetable.csv">⬇ 导出课表 (.csv)</a>' +
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
      '</section>';
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
      '<button type="button" class="tab ' + (schedUI.subTab === 'approvals' ? 'active' : '') + '" data-sched-action="subtab" data-tab="approvals">📝 调课审批与日志' + (pendingCount ? ' (' + pendingCount + ')' : '') + '</button>' +
      '</div>';
    const content = schedUI.subTab === 'timetable' ? renderTimetableTab(d) : schedUI.subTab === 'basedata' ? renderBaseDataTab(d) : renderApprovalsTab(d);
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
        return '<td>' + (list.length ? list.map(e => '<div style="padding:6px;border-radius:8px;border:1px solid var(--border);background:#fff"><strong>' + esc(e.subjectName) + '</strong><div class="tiny muted">' + esc(e.className) + (e.teacherName ? ' · ' + esc(e.teacherName) : '') + (e.roomName ? ' · ' + esc(e.roomName) : '') + '</div></div>').join('') : '<span class="tiny muted">' + (isTeacher ? '无课' : '—') + '</span>') + '</td>';
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
    if (act === 'approve-swap' || act === 'reject-swap') {
      const decision = act === 'approve-swap' ? 'approve' : 'reject';
      run(async () => { await api('/api/admin/schedule/requests/' + encodeURIComponent(btn.dataset.id) + '/review', { method: 'POST', body: JSON.stringify({ decision }) }); await refreshAdminSchedule(); showToast(decision === 'approve' ? '已同意并自动更新课表' : '已驳回'); }, '审批失败: ');
    }
  });

  document.addEventListener('change', event => {
    const sel = event.target.dataset?.schedSelect;
    if (!sel) return;
    if (sel === 'class') schedUI.selectedClassId = event.target.value;
    else if (sel === 'teacher') schedUI.selectedTeacherId = event.target.value;
    else if (sel === 'room') schedUI.selectedRoomId = event.target.value;
    else if (sel === 'rule-teacher') schedUI.selectedRuleTeacherId = event.target.value;
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
    const ids = ['sched-settings-form', 'sched-grade-form', 'sched-class-form', 'sched-subject-form', 'sched-room-form', 'sched-plan-form', 'sched-teacher-rule-form', 'sched-manual-entry-form', 'sched-force-form', 'teacher-swap-req-form'];
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
    } else if (form.id === 'teacher-swap-req-form') {
      run(async () => {
        await api('/api/teacher/schedule/requests', { method: 'POST', body: JSON.stringify(values) });
        await loadMyTimetable(); showToast('调课申请已提交管理员审批');
      }, '提交失败: ');
    }
  }, true);
})();
