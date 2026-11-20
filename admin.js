// Administrator workspace and email password recovery. Loaded after the standard UI extensions.
(() => {
  const originalAuthPage = authPage;
  const originalRender = render;
  let resetToken = new URLSearchParams(location.search).get('reset') || '';
  let resetNotice = '';
  let adminData = null;
  let adminLoading = false;
  let adminError = '';
  let adminTab = 'teachers';
  let adminDialog = null;
  let deptDialogUser = null;
  let annEditItem = null;
  let courseEditItem = null;
  let courseStudentsModal = null;
  let courseFilter = { q: '', department: '', teacherId: '', academicYear: '', discipline: '' };
  let teacherFilter = { q: '', department: '', major: '', status: '', position: '' };
  let studentFilter = { q: '', department: '', major: '', gender: '' };

  if (resetToken) {
    // Never leave the one-use token visible in browser history after opening the email link.
    history.replaceState(null, '', location.pathname + location.hash);
    state.authMode = 'reset';
  }

  function authRecoveryPage() {
    const resetting = state.authMode === 'reset';
    const heading = resetting ? 'Set a New Password' : 'Forgot Your Password?';
    const explanation = resetting
      ? 'Choose a new password for your account. The link in your email can only be used once.'
      : 'Enter your account email. If it is registered, we will send a password reset link.';
    const fields = resetting
      ? '<div class="field"><label for="new-password">New Password</label><input id="new-password" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div>' +
        '<div class="field"><label for="confirm-password">Confirm New Password</label><input id="confirm-password" name="confirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div>'
      : '<div class="field"><label for="recovery-email">Email Address</label><input id="recovery-email" name="email" type="email" placeholder="you@example.com" autocomplete="email" required></div>';
    return '<div class="auth-layout"><section class="auth-brand-panel">' + brand() +
      '<div class="auth-promo"><div class="eyebrow">ACCOUNT ACCESS</div><h1>Get back to learning.</h1><p>Secure account recovery for students, instructors, and administrators.</p></div>' +
      '<footer>© ' + new Date().getFullYear() + ' Zhixing Learning</footer></section>' +
      '<section class="auth-form-panel"><div class="auth-topnav"><button type="button" data-admin-action="back-to-login">Back to Sign In →</button></div>' +
      '<div class="auth-form-wrap"><div class="eyebrow">ACCOUNT RECOVERY</div><h2>' + heading + '</h2><p class="intro">' + explanation + '</p>' +
      (resetNotice ? '<div class="panel panel-pad small" role="status" style="margin-bottom:17px">' + esc(resetNotice) + '</div>' : '') +
      '<form id="' + (resetting ? 'admin-reset-confirm' : 'admin-reset-request') + '">' + fields +
      '<button class="btn btn-primary auth-submit" type="submit">' + (resetting ? 'Save New Password' : 'Send Reset Link') + '</button></form>' +
      '<p class="auth-bottom">' + (resetting ? 'Need another link?' : 'Remembered your password?') +
      ' <button type="button" data-admin-action="' + (resetting ? 'forgot' : 'back-to-login') + '">' +
      (resetting ? 'Request a New Link' : 'Sign In') + '</button></p></div></section></div>';
  }

  authPage = function() {
    if (state.authMode === 'forgot' || state.authMode === 'reset') return authRecoveryPage();
    let html = originalAuthPage();
    if (state.authMode === 'register') {
      html = html.replace('</select>', '<option value="admin"' + (state.authRole === 'admin' ? ' selected' : '') + '>⚙ Administrator</option></select>');
      if (state.authRole !== 'admin') {
        const schoolHint = state.authRole === 'teacher' ? 'Instructor school binding requires administrator approval. Leave blank to join later.' : 'For example: 1008611 or Peking University. You can join later from your profile.'; html = html.replace('<div class="field"><label for="auth-email">Email Address</label>', '<div class="field"><label for="auth-school">School / Organization (optional)</label><input id="auth-school" name="school" maxlength="100" placeholder="Enter a school code or exact school name"><div class="field-hint">' + schoolHint + '</div></div><div class="field"><label for="auth-email">Email Address</label>');
      } else {
        html = html.replace('Create Your Teaching Workspace', 'Create a School Organization');
        html = html.replace('Create an instructor account, then create courses and share enrollment codes with students.', 'Create your school organization and invite instructors and students with its code or exact name.');
        html = html.replace('Instructor Account ID', 'Administrator Account ID');
        html = html.replace('For example tch202601', 'For example SIU199901');
        html = html.replace('Must start with tch followed by digits (e.g. tch202601).', 'Must start with an English letter using uppercase letters and digits (e.g. SIU199901).');
        html = html.replace('<div class="field"><label for="auth-email">Email Address</label>', '<div class="field"><label for="auth-school-name">School / Organization Name</label><input id="auth-school-name" name="schoolName" maxlength="100" placeholder="For example, Peking University" required></div><div class="field"><label for="auth-school-code">School Code (optional)</label><input id="auth-school-code" name="schoolCode" maxlength="16" placeholder="For example, 1008611"><div class="field-hint">Each school and code can only register one administrator account. Leave blank to generate automatically.</div></div><div class="field"><label for="auth-email">Email Address</label>');
        html = html.replace('Create Instructor Account →', 'Create School Administrator Account →');
        html = html.replace('Already have an account?', 'Already have an administrator account?');
      }
    }
    if (state.authMode === 'login') {
      html = html.replace('</form><p class="auth-bottom">', '</form><p class="auth-bottom"><button type="button" data-admin-action="forgot">Forgot password?</button></p><p class="auth-bottom">');
    }
    return html.replace('name@university.edu', 'you@example.com');
  };

  function startAdminLoad() {
    if (adminData || adminLoading || adminError) return;
    adminLoading = true;
    api('/api/admin/overview').then(data => {
      adminData = data;
      adminError = '';
    }).catch(error => {
      adminError = error.message;
    }).finally(() => {
      adminLoading = false;
      if (state.user?.role === 'admin') render();
    });
  }

  function uniqueValues(items, key) {
    return [...new Set((items || []).map(x => String(x[key] || '').trim()).filter(Boolean))].sort();
  }
  function matchesQuery(item, q) {
    if (!q) return true;
    const hay = [item.name, item.accountId, item.studentId, item.email, item.department, item.major, item.school?.name, item.school?.code].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  const TEACHER_POSITIONS = ['校长', '副校长', '院长', '副院长', '教务处长', '课题组长', '教师'];
  const POSITION_BADGE_COLORS = {
    '校长': 'background:#fef3c7;color:#b45309;border:1px solid #fcd34d',
    '副校长': 'background:#ffedd5;color:#c2410c;border:1px solid #fdba74',
    '院长': 'background:#ede9fe;color:#6d28d9;border:1px solid #c4b5fd',
    '副院长': 'background:#e0e7ff;color:#4338ca;border:1px solid #a5b4fc',
    '教务处长': 'background:#dcfce7;color:#15803d;border:1px solid #86efac',
    '课题组长': 'background:#cffafe;color:#0e7490;border:1px solid #67e8f9',
    '教师': 'background:#f1f5f9;color:#475569;border:1px solid #cbd5e1'
  };
  function positionOptionsHtml(selected) {
    const cur = TEACHER_POSITIONS.includes(selected) ? selected : '教师';
    return TEACHER_POSITIONS.map(p => '<option value="' + p + '"' + (cur === p ? ' selected' : '') + '>' + p + '</option>').join('');
  }

  const ANN_CATEGORIES = { school: 'School Information (学校信息)', college: 'College Information (学院信息)', academic: 'Academic Affairs (教务管理)' };
  function departmentPanel() {
    const depts = adminData?.departments || [];
    const tags = depts.map(d => '<span class="pill blue" style="display:inline-flex;align-items:center;gap:6px">' + esc(d.name) +
      (d.id ? '<button type="button" data-admin-action="delete-dept" data-id="' + esc(d.id) + '" style="border:0;background:none;color:inherit;cursor:pointer;font-weight:800;padding:0" title="Remove">×</button>' : '') +
      '</span>').join('');
    return '<section class="panel panel-pad" style="margin-bottom:20px"><div class="row-between wrap"><div><h2>Department Management (院系管理)</h2>' +
      '<p class="small muted">Manage departments for your school and assign instructors or students below.</p></div></div>' +
      '<div class="row wrap" style="gap:8px;margin:10px 0 14px">' + (tags || '<span class="small muted">No departments configured yet.</span>') + '</div>' +
      '<form id="admin-add-dept-form"><div class="row wrap"><input name="name" maxlength="80" placeholder="Enter department name (e.g. 计算机学院)" required style="max-width:320px">' +
      '<button type="submit" class="btn btn-soft btn-sm">+ Add Department</button></div></form></section>';
  }
  function coursesTable() {
    const allCourses = adminData?.courses || [];
    const activeTeachers = (adminData?.teachers || []).filter(t => t.active);
    const depts = [...new Set([...(adminData?.departments || []).map(d => d.name), ...activeTeachers.map(t => t.department).filter(Boolean)])].sort();
    const teachersInDept = courseFilter.department ? activeTeachers.filter(t => (t.department || '') === courseFilter.department) : activeTeachers;
    const filteredCourses = allCourses.filter(c => {
      if (courseFilter.q) {
        const hay = [c.title, c.category, c.enrollmentCode, c.teacherName, ...(c.departments || [])].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(courseFilter.q.toLowerCase())) return false;
      }
      if (courseFilter.department) {
        const cDepts = new Set(c.departments || []);
        const matchTeacherDept = (c.teacherIds || [c.teacherId]).some(tid => {
          const t = activeTeachers.find(x => x.id === tid);
          return t && (t.department || '') === courseFilter.department;
        });
        if (!cDepts.has(courseFilter.department) && !matchTeacherDept) return false;
      }
      if (courseFilter.teacherId) {
        const tIds = c.teacherIds || [c.teacherId];
        if (!tIds.includes(courseFilter.teacherId)) return false;
      }
      if (courseFilter.academicYear && (c.academicYear || '') !== courseFilter.academicYear) return false;
      if (courseFilter.discipline && (c.category || '') !== courseFilter.discipline) return false;
      return true;
    });
    const editing = courseEditItem;
    const selectedIds = new Set(editing ? (editing.teacherIds || [editing.teacherId]) : []);
    const teacherCheckboxes = activeTeachers.length
      ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;max-height:180px;overflow:auto;padding:10px;border:1px solid var(--border);border-radius:10px;background:#fafbfe">' +
        activeTeachers.map(t => '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" name="teacherIds" value="' + esc(t.id) + '"' + (selectedIds.has(t.id) ? ' checked' : '') + '><span><strong>' + esc(t.name) + '</strong> <small class="muted">(' + esc(t.department || 'Unassigned') + ')</small></span></label>').join('') +
        '</div>'
      : '<p class="small muted">No active instructors available. Add or approve an instructor first.</p>';
    const selectedTargetDepts = new Set(editing?.targetDepartments || []);
    const targetDeptChecks = depts.length ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;max-height:140px;overflow:auto;padding:8px;border:1px solid var(--border);border-radius:10px;background:#fafbfe">' +
      depts.map(d => '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" name="targetDepartments" value="' + esc(d) + '"' + (selectedTargetDepts.has(d) ? ' checked' : '') + '><span>' + esc(d) + '</span></label>').join('') + '</div>' : '<p class="small muted">No departments configured yet.</p>';
    const allMajors = [...new Set((adminData?.students || []).map(s => s.major).filter(Boolean))].sort();
    const formYears = [...new Set(allCourses.map(c => c.academicYear).filter(Boolean))].sort();
    const formHtml = '<section class="panel panel-pad" style="margin-bottom:20px"><h2>' + (editing ? 'Edit Course & Assigned Instructors' : 'Create Course & Assign Instructor(s)') + '</h2>' +
      '<p class="small muted">Administrators can create courses and assign one or multiple instructors to teach together.</p>' +
      '<form id="admin-course-form"' + (editing ? ' data-id="' + esc(editing.id) + '"' : '') + '>' +
      '<div class="form-grid"><div class="field"><label for="admin-course-title">Course Name *</label><input id="admin-course-title" name="title" value="' + esc(editing?.title || '') + '" maxlength="100" placeholder="e.g. Introduction to AI" required></div>' +
      '<div class="field"><label for="admin-course-category">学科 / Category *</label><input id="admin-course-category" name="category" value="' + esc(editing?.category || 'General Studies') + '" maxlength="40" required></div>' +
      '<div class="field"><label for="admin-course-code">Enrollment Code (optional)</label><input id="admin-course-code" name="enrollmentCode" value="' + esc(editing?.enrollmentCode || '') + '" maxlength="20" placeholder="Leave blank to auto-generate"></div></div>' +
      '<div class="field"><label for="admin-course-desc">Description *</label><textarea id="admin-course-desc" name="description" rows="2" maxlength="2000" placeholder="Course goals and overview…" required>' + esc(editing?.description || '') + '</textarea></div>' +
      '<div class="form-grid"><div class="field"><label for="admin-course-year">学年 / Academic Year</label><input id="admin-course-year" name="academicYear" list="admin-course-years" value="' + esc(editing?.academicYear || '') + '" maxlength="40" placeholder="e.g. 2026-2027"></div>' +
      '<div class="field"><label for="admin-course-majors">学科/专业（逗号分隔）</label><input id="admin-course-majors-text" name="targetMajorsText" list="admin-course-major-options" value="' + esc((editing?.targetMajors || []).join(',')) + '" maxlength="300" placeholder="教育学,学前教育"></div></div>' +
      '<datalist id="admin-course-years">' + formYears.map(y => '<option value="' + esc(y) + '"></option>').join('') + '</datalist>' +
      '<datalist id="admin-course-major-options">' + allMajors.map(m => '<option value="' + esc(m) + '"></option>').join('') + '</datalist>' +
      '<div class="field"><label>目标学院 / Target Departments（不选表示不限）</label>' + targetDeptChecks + '</div>' +
      '<label class="small" style="display:flex;align-items:center;gap:8px;margin:8px 0 14px;cursor:pointer"><input type="checkbox" name="autoEnroll"' + (editing?.autoEnroll ? ' checked' : '') + '><span>自动同步符合条件的学生到本课程（Auto-enroll matching students）</span></label>' +
      '<div class="field"><label>Assign Instructor(s) * (multi-select)</label>' + teacherCheckboxes + '</div>' +
      '<div class="row wrap"><button type="submit" class="btn btn-primary">' + (editing ? 'Save Course Changes' : 'Create Course') + '</button>' +
      (editing ? '<button type="button" class="btn btn-light" data-admin-action="cancel-edit-course">Cancel</button>' : '') + '</div></form></section>';
    const academicYears = [...new Set(allCourses.map(c => c.academicYear).filter(Boolean))].sort();
    const disciplines = [...new Set(allCourses.map(c => c.category).filter(Boolean))].sort();
    const filterBar = '<div class="filter-line" style="padding:0 20px 14px"><div class="searchbar"><span>⌕</span><input id="course-filter-q" data-admin-filter="course-q" type="search" value="' + esc(courseFilter.q) + '" placeholder="Search course, code, category, instructor"></div>' +
      '<div class="row wrap"><select data-admin-filter="course-department" aria-label="Filter by department"><option value="">All Departments (按学院筛选)</option>' + depts.map(d => '<option value="' + esc(d) + '"' + (courseFilter.department === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select>' +
      '<select data-admin-filter="course-teacher" aria-label="Filter by instructor"><option value="">All Instructors (按老师筛选)</option>' + teachersInDept.map(t => '<option value="' + esc(t.id) + '"' + (courseFilter.teacherId === t.id ? ' selected' : '') + '>' + esc(t.name) + (t.department ? ' · ' + esc(t.department) : '') + '</option>').join('') + '</select>' +
      '<select data-admin-filter="course-year" aria-label="Filter by academic year"><option value="">All Academic Years (全部学年)</option>' + academicYears.map(y => '<option value="' + esc(y) + '"' + (courseFilter.academicYear === y ? ' selected' : '') + '>' + esc(y) + '</option>').join('') + '</select>' +
      '<select data-admin-filter="course-discipline" aria-label="Filter by discipline"><option value="">All Disciplines (全部学科)</option>' + disciplines.map(d => '<option value="' + esc(d) + '"' + (courseFilter.discipline === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select></div></div>';
    const rows = filteredCourses.map(c => '<tr><td><strong>' + esc(c.title) + '</strong><br><span class="tiny muted">' + [c.academicYear ? esc(c.academicYear) : '', esc(c.category || 'General'), 'Code: <code>' + esc(c.enrollmentCode || '—') + '</code>', (c.targetDepartments || []).map(esc).join('/')].filter(Boolean).join(' · ') + '</span></td>' +
      '<td>' + esc(c.teacherName || 'Instructor') + '</td>' +
      '<td>' + esc((c.departments || []).join(', ') || '—') + '</td>' +
      '<td><span class="pill blue">' + n(c.studentCount) + ' students</span></td>' +
      '<td>' + n(c.lessonCount) + ' units · ' + (c.quizAvailable ? 'Quiz Ready' : 'No Quiz') + '</td>' +
      '<td><div class="row wrap"><button type="button" class="btn btn-light btn-sm" data-admin-action="view-course-students" data-id="' + esc(c.id) + '">Students (' + n(c.studentCount) + ')</button>' +
      '<button type="button" class="btn btn-primary btn-sm" data-admin-action="manage-course" data-id="' + esc(c.id) + '">Manage Content →</button><button type="button" class="btn btn-soft btn-sm" data-admin-action="edit-course" data-id="' + esc(c.id) + '">Edit</button>' +
      '<button type="button" class="btn btn-light btn-sm" data-admin-action="duplicate-course" data-id="' + esc(c.id) + '">Duplicate</button>' +
      '<button type="button" class="btn btn-danger btn-sm" data-admin-action="delete-course" data-id="' + esc(c.id) + '">Delete</button></div></td></tr>').join('');
    return formHtml + '<section class="panel"><div class="panel-pad"><h2>Course Management <span class="pill blue">' + filteredCourses.length + ' / ' + allCourses.length + '</span></h2>' +
      '<p class="small muted">Filter by college/department and instructor to inspect course enrollment and details.</p></div>' +
      filterBar + '<div class="table-wrap"><table class="data-table"><thead><tr><th>Course</th><th>Instructor(s)</th><th>Department</th><th>Enrolled</th><th>Content</th><th>Actions</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">No matching courses.</td></tr>') + '</tbody></table></div></section>';
  }
  function backupPanel() {
    return '<section class="panel panel-pad" style="margin-bottom:20px"><h2>Export Data Backup (导出数据备份)</h2>' +
      '<p class="small muted">Download a JSON backup of all schools, accounts, departments, announcements, courses, and grades before redeploying.</p>' +
      '<a class="btn btn-primary" href="/api/admin/backup/export" download>⬇ Export Full Backup (.json)</a></section>' +
      '<section class="panel panel-pad"><h2>Merge & Restore Historical Data (合并恢复历史数据)</h2>' +
      '<p class="small muted">Upload a previously exported <code>.json</code> backup file. Existing records are preserved and historical records are safely merged without duplicates.</p>' +
      '<form id="admin-backup-merge-form" style="margin-top:12px"><div class="row wrap">' +
      '<input id="admin-backup-file" type="file" accept=".json,application/json" required>' +
      '<button type="submit" class="btn btn-soft">Merge Backup Data</button></div></form></section>';
  }
  function announcementsTable() {
    const list = adminData?.announcements || [];
    const editing = annEditItem;
    const formHtml = '<section class="panel panel-pad" style="margin-bottom:20px"><h2>' + (editing ? 'Edit Announcement' : 'Publish Information Announcement') + '</h2>' +
      '<p class="small muted">Published announcements appear on the main dashboard for all instructors and students in your school.</p>' +
      '<form id="admin-announcement-form"' + (editing ? ' data-id="' + esc(editing.id) + '"' : '') + '>' +
      '<div class="form-grid"><div class="field"><label for="ann-category">Category</label><select id="ann-category" name="category">' +
      Object.entries(ANN_CATEGORIES).map(([k, label]) => '<option value="' + k + '"' + (editing?.category === k ? ' selected' : '') + '>' + label + '</option>').join('') +
      '</select></div><div class="field"><label for="ann-title">Title</label><input id="ann-title" name="title" value="' + esc(editing?.title || '') + '" maxlength="120" placeholder="Announcement title" required></div></div>' +
      '<div class="field"><label for="ann-content">Content</label><textarea id="ann-content" name="content" rows="4" maxlength="5000" placeholder="Write announcement details…" required>' + esc(editing?.content || '') + '</textarea></div>' +
      '<div class="row wrap"><button type="submit" class="btn btn-primary">' + (editing ? 'Save Changes' : 'Publish Announcement') + '</button>' +
      (editing ? '<button type="button" class="btn btn-light" data-admin-action="cancel-edit-ann">Cancel</button>' : '') + '</div></form></section>';
    const rows = list.length ? list.map(a => '<section class="panel panel-pad" style="margin-bottom:14px"><div class="row-between wrap"><div>' +
      '<span class="pill blue">' + esc(ANN_CATEGORIES[a.category] || a.category) + '</span> ' +
      '<strong style="font-size:16px;margin-left:6px">' + esc(a.title) + '</strong>' +
      '<div class="tiny muted" style="margin-top:4px">By ' + esc(a.authorName || 'Administrator') + ' · ' + fmtDate(a.updatedAt || a.createdAt) + '</div></div>' +
      '<div class="row wrap"><button type="button" class="btn btn-soft btn-sm" data-admin-action="edit-ann" data-id="' + esc(a.id) + '">Edit</button>' +
      '<button type="button" class="btn btn-danger btn-sm" data-admin-action="delete-ann" data-id="' + esc(a.id) + '">Delete</button></div></div>' +
      '<p style="margin:12px 0 0;white-space:pre-wrap">' + esc(a.content) + '</p></section>').join('')
      : em('No announcements yet', 'Publish school, college, or academic affairs announcements above.');
    return formHtml + rows;
  }
  function instructorTable() {
    const allTeachers = adminData?.teachers || [];
    const pending = adminData?.pendingTeachers || [];
    const depts = uniqueValues(allTeachers, 'department');
    const majors = uniqueValues(allTeachers, 'major');
    const teachers = allTeachers.filter(t => {
      if (!matchesQuery(t, teacherFilter.q)) return false;
      if (teacherFilter.department && (t.department || '') !== teacherFilter.department) return false;
      if (teacherFilter.major && (t.major || '') !== teacherFilter.major) return false;
      if (teacherFilter.status === 'active' && !t.active) return false;
      if (teacherFilter.status === 'inactive' && t.active) return false;
      if (teacherFilter.position && (t.position || '教师') !== teacherFilter.position) return false;
      return true;
    });
    const pendingSection = pending.length
      ? '<section class="panel" style="margin-bottom:20px"><div class="panel-pad"><h2>Pending School Binding Requests <span class="pill blue">' + pending.length + '</span></h2>' +
        '<p class="small muted">Review instructors who requested to bind their account to a school code.</p></div>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>Instructor</th><th>Account ID</th><th>Requested School</th><th>Actions</th></tr></thead><tbody>' +
        pending.map(t => '<tr><td><strong>' + esc(t.name) + '</strong><br><span class="muted">' + esc(t.email) + '</span></td><td>' + esc(t.accountId || '—') +
          '</td><td><strong>' + esc(t.pendingSchool?.name || '') + '</strong><br><span class="muted">Code: ' + esc(t.pendingSchool?.code || '') + '</span></td>' +
          '<td><div class="row wrap"><button type="button" class="btn btn-primary btn-sm" data-admin-action="approve-teacher" data-id="' + esc(t.id) + '">Approve</button>' +
          '<button type="button" class="btn btn-danger btn-sm" data-admin-action="reject-teacher" data-id="' + esc(t.id) + '">Reject</button></div></td></tr>').join('') +
        '</tbody></table></div></section>'
      : '';
    const importSection = '<section class="panel panel-pad" style="margin-bottom:20px"><div class="row-between wrap"><div><h2>Bulk Import Instructors</h2>' +
      '<p class="small muted">Download the CSV template or prepare an XLSX/CSV file; fill in instructor rows (role, name, gender, schoolCode, department, major, accountId, password), and import directly.</p></div>' +
      '<a class="btn btn-light btn-sm" href="/api/admin/import/template?role=teacher" download="teacher-import-template.csv">⬇ Download Teacher Template (.csv)</a></div>' +
      '<form id="admin-import-teacher-form" style="margin-top:12px"><div class="row wrap">' +
      '<input id="admin-import-teacher-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required>' +
      '<button type="submit" class="btn btn-primary btn-sm">Import Instructor Roster</button></div></form></section>';
    const filterBar = '<div class="filter-line" style="padding:0 20px 14px"><div class="searchbar"><span>⌕</span><input id="teacher-filter-q" data-admin-filter="teacher-q" type="search" value="' + esc(teacherFilter.q) + '" placeholder="Search name, account ID, email, department, major"></div>' +
      '<div class="row wrap"><select data-admin-filter="teacher-department" aria-label="Filter by department"><option value="">All Departments</option>' + depts.map(d => '<option value="' + esc(d) + '"' + (teacherFilter.department === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select>' +
      '<select data-admin-filter="teacher-major" aria-label="Filter by major"><option value="">All Majors</option>' + majors.map(m => '<option value="' + esc(m) + '"' + (teacherFilter.major === m ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select>' +
      '<select data-admin-filter="teacher-position" aria-label="按职位筛选"><option value="">所有职位 (All Positions)</option>' + TEACHER_POSITIONS.map(p => '<option value="' + p + '"' + (teacherFilter.position === p ? ' selected' : '') + '>' + p + '</option>').join('') + '</select>' +
      '<select data-admin-filter="teacher-status" aria-label="Filter by status"><option value="">所有账号状态</option><option value="active"' + (teacherFilter.status === 'active' ? ' selected' : '') + '>在职/正常</option><option value="inactive"' + (teacherFilter.status === 'inactive' ? ' selected' : '') + '>已停用</option></select></div></div>';
    const rows = teachers.map(t => '<tr><td><strong>' + esc(t.name) + '</strong>' + (t.gender ? ' <span class="tiny muted">(' + esc(t.gender) + ')</span>' : '') + '<br><span class="muted">' + esc(t.email) + '</span></td>' +
      '<td>' + esc(t.accountId || '—') + '</td><td>' + esc(t.school?.name || 'Unassigned') + '</td>' +
      '<td>' + esc([t.department, t.major].filter(Boolean).join(' · ') || '—') + '</td>' +
      '<td><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<select data-admin-teacher-pos="' + esc(t.id) + '" aria-label="设置教师职位" style="min-height:32px;padding:4px 8px;font-size:12px;font-weight:700;border-radius:8px;width:auto;' + (POSITION_BADGE_COLORS[t.position || '教师'] || '') + '">' + positionOptionsHtml(t.position || '教师') + '</select>' +
        (t.active ? '' : '<span class="pill gray">已停用</span>') +
      '</div></td><td>' + n(t.courseCount) + '</td><td>' +
      (t.active ? '<div class="row wrap"><button type="button" class="btn btn-light btn-sm" data-admin-action="assign-dept" data-id="' + esc(t.id) + '" data-role="teacher">Assign Dept</button><button type="button" class="btn btn-soft btn-sm" data-admin-action="password" data-id="' + esc(t.id) + '" data-role="teacher">Reset Password</button>' +
      '<button type="button" class="btn btn-danger btn-sm" data-admin-action="remove-teacher" data-id="' + esc(t.id) + '">Deactivate</button></div>' : '<div class="row wrap"><button type="button" class="btn btn-soft btn-sm" data-admin-action="restore-teacher" data-id="' + esc(t.id) + '">Restore</button><button type="button" class="btn btn-danger btn-sm" data-admin-action="delete-teacher-permanent" data-id="' + esc(t.id) + '">Delete</button></div>') + '</td></tr>').join('');
    return pendingSection + departmentPanel() + importSection + '<section class="panel panel-pad" style="margin-bottom:20px"><h2>Add an Instructor</h2><p class="small muted">Create a separate login for each instructor.</p>' +
      '<form id="admin-add-teacher"><div class="form-grid"><div class="field"><label for="admin-teacher-name">姓名 (Name) *</label><input id="admin-teacher-name" name="name" required maxlength="60" placeholder="例如：吴彦祖"></div>' +
      '<div class="field"><label for="admin-teacher-email">电子邮件 (Email) *</label><input id="admin-teacher-email" name="email" type="email" placeholder="teacher@example.com" required></div>' +
      '<div class="field"><label for="admin-teacher-position">职务 / 职位 (Position)</label><select id="admin-teacher-position" name="position">' + positionOptionsHtml('教师') + '</select></div>' +
      '<div class="field"><label for="admin-teacher-dept">所属院系 (Department)</label><input id="admin-teacher-dept" name="department" list="admin-add-teacher-dept-list" maxlength="80" placeholder="可选，如：计算机学院"><datalist id="admin-add-teacher-dept-list">' + (adminData?.departments || []).map(d => '<option value="' + esc(d.name) + '">').join('') + '</datalist></div>' +
      '<div class="field"><label for="admin-teacher-password">临时密码 (Temporary Password) *</label><input id="admin-teacher-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="至少8位字符"></div></div>' +
      '<button type="submit" class="btn btn-primary">创建教师账户</button></form></section>' +
      '<section class="panel"><div class="panel-pad"><h2>Instructor Accounts <span class="pill blue">' + teachers.length + ' / ' + allTeachers.length + '</span></h2><p class="small muted">Deactivate an account to prevent sign-in while retaining its courses and records.</p></div>' +
      filterBar + '<div class="table-wrap"><table class="data-table"><thead><tr><th>Instructor</th><th>Account ID</th><th>School</th><th>Dept / Major</th><th>职位 (Position)</th><th>Courses</th><th>Actions</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7">No matching instructor accounts.</td></tr>') + '</tbody></table></div></section>';
  }

  function studentTable() {
    const allStudents = adminData?.students || [];
    const courses = adminData?.courses || [];
    const depts = uniqueValues(allStudents, 'department');
    const majors = uniqueValues(allStudents, 'major');
    const genders = uniqueValues(allStudents, 'gender');
    const students = allStudents.filter(s => {
      if (!matchesQuery(s, studentFilter.q)) return false;
      if (studentFilter.department && (s.department || '') !== studentFilter.department) return false;
      if (studentFilter.major && (s.major || '') !== studentFilter.major) return false;
      if (studentFilter.gender && (s.gender || '') !== studentFilter.gender) return false;
      return true;
    });
    const importSection = '<section class="panel panel-pad" style="margin-bottom:20px"><div class="row-between wrap"><div><h2>Bulk Import Students</h2>' +
      '<p class="small muted">Download the CSV template or prepare an XLSX/CSV file; fill in student rows (role, name, gender, studentId, schoolCode, department, major, accountId, password), and import to auto-register accounts.</p></div>' +
      '<a class="btn btn-light btn-sm" href="/api/admin/import/template?role=student" download="student-import-template.csv">⬇ Download Student Template (.csv)</a></div>' +
      '<form id="admin-import-student-form" style="margin-top:12px"><div class="row wrap">' +
      '<input id="admin-import-student-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required>' +
      '<button type="submit" class="btn btn-primary btn-sm">Import Student Roster</button></div></form></section>';
    const filterBar = '<div class="filter-line" style="margin-bottom:16px"><div class="searchbar"><span>⌕</span><input id="student-filter-q" data-admin-filter="student-q" type="search" value="' + esc(studentFilter.q) + '" placeholder="Search name, student ID, email, department, major"></div>' +
      '<div class="row wrap"><select data-admin-filter="student-department" aria-label="Filter by department"><option value="">All Departments</option>' + depts.map(d => '<option value="' + esc(d) + '"' + (studentFilter.department === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select>' +
      '<select data-admin-filter="student-major" aria-label="Filter by major"><option value="">All Majors</option>' + majors.map(m => '<option value="' + esc(m) + '"' + (studentFilter.major === m ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select>' +
      '<select data-admin-filter="student-gender" aria-label="Filter by gender"><option value="">All Genders</option>' + genders.map(g => '<option value="' + esc(g) + '"' + (studentFilter.gender === g ? ' selected' : '') + '>' + esc(g) + '</option>').join('') + '</select></div></div>';
    if (!allStudents.length) return departmentPanel() + importSection + em('No students yet', 'Students will appear here after registering or importing.');
    const cards = students.length ? students.map(s => {
      const enrolled = new Set((s.enrollments || []).map(e => e.courseId));
      const list = (s.enrollments || []).map(e => '<div class="student-detail-row"><span><strong>' + esc(e.courseTitle) + '</strong> · ' + esc(e.teacherName || 'Instructor') + '</span>' +
        '<button class="btn btn-danger btn-sm" type="button" data-admin-action="remove-enrollment" data-student-id="' + esc(s.id) + '" data-course-id="' + esc(e.courseId) + '">Remove</button></div>').join('');
      const available = courses.filter(c => !enrolled.has(c.id));
      const options = available.map(c => '<option value="' + esc(c.id) + '">' + esc(c.title) + ' · ' + esc(c.teacherName || 'Instructor') + '</option>').join('');
      const addForm = available.length ? '<form class="admin-enrollment-form" data-student-id="' + esc(s.id) + '"><div class="row wrap"><select name="courseId" aria-label="Course to add" required>' + options +
        '</select><button class="btn btn-soft btn-sm" type="submit">Add to Course</button></div></form>' : '<p class="small muted">Enrolled in every available course.</p>';
      const metaParts = [s.email, 'Student ID ' + (s.studentId || 'N/A'), s.gender, [s.department, s.major].filter(Boolean).join(' · '), s.school?.name || 'Unassigned'].filter(Boolean);
      return '<section class="panel panel-pad" style="margin-bottom:16px"><div class="row-between"><div><h2 style="margin:0 0 5px">' + esc(s.name) + '</h2><p class="small muted" style="margin:0">' +
        esc(metaParts.join(' · ')) + '</p></div><div class="row wrap"><button class="btn btn-light btn-sm" type="button" data-admin-action="assign-dept" data-id="' + esc(s.id) +
        '" data-role="student">Assign Dept</button><button class="btn btn-soft btn-sm" type="button" data-admin-action="password" data-id="' + esc(s.id) +
        '" data-role="student">Reset Password</button></div></div><div class="student-detail">' + (list || '<p class="small muted">No enrolled courses.</p>') + '</div>' +
        '<div style="margin-top:16px"><strong class="small">Adjust Course Enrollment</strong>' + addForm + '</div></section>';
    }).join('') : em('No matching students', 'Try adjusting your search or filter criteria.');
    return departmentPanel() + importSection + filterBar + cards;
  }

  function courseStudentsDialog() {
    if (!courseStudentsModal) return '';
    const c = courseStudentsModal;
    const list = c.enrolledStudents || [];
    const enrolledIds = new Set(list.map(s => s.id));
    const available = (adminData?.students || []).filter(s => !enrolledIds.has(s.id));
    const studentOptions = available.map(s => '<option value="' + esc(s.id) + '">' + esc(s.name) + ' (' + esc(s.studentId || s.email || 'No ID') + ')' + (s.department ? ' · ' + esc(s.department) : '') + '</option>').join('');
    const enrolledRows = list.length ? list.map(s => '<div class="student-detail-row" style="align-items:center;gap:10px">' +
      '<label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer"><input type="checkbox" name="removeStudentIds" value="' + esc(s.id) + '"><span><strong>' + esc(s.name) + '</strong> (' + esc(s.studentId || s.email || 'No ID') + ')</span></label>' +
      '<span class="tiny muted">' + esc([s.department, s.major].filter(Boolean).join(' · ') || 'No dept') + '</span>' +
      '<button class="btn btn-danger btn-sm" type="button" data-admin-action="remove-enrollment" data-student-id="' + esc(s.id) + '" data-course-id="' + esc(c.id) + '">Remove</button></div>').join('') : '<p class="small muted">No students enrolled in this course yet.</p>';
    const addForm = available.length
      ? '<form id="admin-course-add-students-form" data-course-id="' + esc(c.id) + '" style="margin-top:16px"><div class="field"><label>Add students (hold Cmd/Ctrl to select multiple)</label><select name="studentIds" multiple size="6" style="width:100%;min-height:140px">' + studentOptions + '</select></div><div class="row wrap" style="margin-top:10px"><button type="submit" class="btn btn-primary btn-sm">Add selected students</button><span class="small muted">' + available.length + ' student(s) available</span></div></form>'
      : '<p class="small muted" style="margin-top:16px">All students are already enrolled in this course.</p>';
    const removeForm = list.length
      ? '<form id="admin-course-remove-students-form" data-course-id="' + esc(c.id) + '" style="margin-top:18px"><div class="row-between"><strong class="small">Remove students</strong><button type="submit" class="btn btn-danger btn-sm">Remove selected</button></div><div style="max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:8px;margin-top:8px">' + enrolledRows + '</div></form>'
      : '';
    return '<div class="modal-backdrop" data-admin-action="close-course-students"><div class="modal" style="max-width:760px"><div class="modal-head"><h2>' + esc(c.title) + ' · Enrolled Students (' + list.length + ')</h2>' +
      '<button class="icon-btn" type="button" data-admin-action="close-course-students" aria-label="Close">✕</button></div><div class="modal-body">' +
      '<p class="small muted">Instructor(s): <strong>' + esc(c.teacherName) + '</strong> · Enrollment Code: <code>' + esc(c.enrollmentCode || '—') + '</code></p>' +
      addForm + removeForm +
      '</div><div class="modal-actions"><button class="btn btn-light" type="button" data-admin-action="close-course-students">Close</button></div></div></div>';
  }
  function deptDialog() {
    if (!deptDialogUser) return '';
    const depts = (adminData?.departments || []).map(d => d.name);
    return '<div class="modal-backdrop" data-admin-action="close-dept-dialog"><div class="modal"><div class="modal-head"><h2>Assign Department & Major</h2>' +
      '<button class="icon-btn" type="button" data-admin-action="close-dept-dialog" aria-label="Close">✕</button></div>' +
      '<form id="admin-dept-form" data-id="' + esc(deptDialogUser.id) + '"><div class="modal-body">' +
      '<p class="small muted">Update department and major for <strong>' + esc(deptDialogUser.name) + '</strong>.</p>' +
      '<div class="field"><label for="admin-user-dept">Department (院系)</label><input id="admin-user-dept" name="department" list="admin-dept-datalist" value="' + esc(deptDialogUser.department || '') + '" maxlength="80" placeholder="Select or type a department">' +
      '<datalist id="admin-dept-datalist">' + depts.map(d => '<option value="' + esc(d) + '">').join('') + '</datalist></div>' +
      '<div class="field"><label for="admin-user-major">Major (专业)</label><input id="admin-user-major" name="major" value="' + esc(deptDialogUser.major || '') + '" maxlength="80" placeholder="Enter major (optional)"></div>' +
      '</div><div class="modal-actions"><button class="btn btn-light" type="button" data-admin-action="close-dept-dialog">Cancel</button>' +
      '<button class="btn btn-primary" type="submit">Save Assignment</button></div></form></div></div>';
  }
  function passwordDialog() {
    if (!adminDialog) return '';
    return '<div class="modal-backdrop" data-admin-action="close-dialog"><div class="modal"><div class="modal-head"><h2>Reset ' + esc(adminDialog.role) +
      ' Password</h2><button class="icon-btn" type="button" data-admin-action="close-dialog" aria-label="Close">✕</button></div><form id="admin-password-form" data-id="' +
      esc(adminDialog.id) + '"><div class="modal-body"><p class="small muted">Set a new password for ' + esc(adminDialog.name) + '.</p><div class="field"><label for="admin-new-password">New Password</label>' +
      '<input id="admin-new-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div><div class="field"><label for="admin-confirm-password">Confirm Password</label>' +
      '<input id="admin-confirm-password" name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div></div><div class="modal-actions">' +
      '<button class="btn btn-light" type="button" data-admin-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">Save Password</button></div></form></div></div>';
  }

  function adminShell(customBody = null) {
    const s = adminData?.stats || {};
    const organization = adminData?.organization;
    const scopeLabel = organization ? 'ORGANIZATION ADMINISTRATION' : 'SITE ADMINISTRATION';
    const organizationPanel = organization
      ? '<section class="panel panel-pad" style="margin-bottom:20px"><div class="row-between wrap"><div><div class="eyebrow">SCHOOL ORGANIZATION</div><h2 style="margin:5px 0">' + esc(organization.name) + '</h2><p class="small muted" style="margin:0">Students and instructors can join with the exact school name or code.</p></div><div><div class="tiny muted">SCHOOL CODE</div><strong style="font-size:20px">' + esc(organization.code) + '</strong></div></div></section>'
      : '';
    const body = customBody != null ? customBody : adminError
      ? '<section class="panel panel-pad"><p class="form-error">' + esc(adminError) + '</p><button class="btn btn-soft" data-admin-action="reload">Retry</button></section>'
      : !adminData ? '<section class="panel panel-pad">Loading administrator records…</section>'
      : '<div class="page-head"><div><div class="eyebrow">' + scopeLabel + '</div><h1>' + (adminTab === 'teachers' ? 'Instructor Accounts' : adminTab === 'students' ? 'Student Accounts' : adminTab === 'courses' ? 'Course Management' : adminTab === 'schedule' ? 'Smart Scheduling (智能排课)' : adminTab === 'announcements' ? 'Information Announcements' : 'Data Backup & Merge') +
        '</h1><p>Manage user access and student course enrollment.</p></div></div>' + organizationPanel + '<div class="stats-grid" style="margin-bottom:24px">' +
        stat('Instructors', n(s.teachers), 'Registered instructor accounts', '♧') + stat('Students', n(s.students), 'Registered student accounts', '▣') +
        stat('Courses', n(s.courses), 'Courses across instructors', '▤') + stat('Announcements', n(s.announcements), 'Published school notices', '◈') + '</div>' + (adminTab === 'teachers' ? instructorTable() : adminTab === 'students' ? studentTable() : adminTab === 'courses' ? coursesTable() : adminTab === 'schedule' ? (typeof renderAdminScheduleWorkspace === 'function' ? renderAdminScheduleWorkspace() : '') : adminTab === 'announcements' ? announcementsTable() : backupPanel());
    return '<div class="mobile-overlay ' + (state.mobileOpen ? 'show' : '') + '" data-admin-action="close-menu"></div><div class="app-shell"><aside class="sidebar ' +
      (state.mobileOpen ? 'open' : '') + '">' + brand() + '<div class="sidebar-label">' + scopeLabel + '</div><nav class="nav-list" aria-label="Administrator Menu">' +
      '<button type="button" class="nav-btn ' + (adminTab === 'teachers' ? 'active' : '') + '" data-admin-action="tab" data-tab="teachers"><span class="ico">♧</span>Instructors' + ((adminData?.pendingTeachers?.length || 0) ? '<span class="nav-count">' + adminData.pendingTeachers.length + '</span>' : '') + '</button>' +
      '<button type="button" class="nav-btn ' + (adminTab === 'students' ? 'active' : '') + '" data-admin-action="tab" data-tab="students"><span class="ico">▣</span>Students</button>' +
      '<button type="button" class="nav-btn ' + (adminTab === 'courses' ? 'active' : '') + '" data-admin-action="tab" data-tab="courses"><span class="ico">▤</span>Courses</button>' +
      '<button type="button" class="nav-btn ' + (adminTab === 'schedule' ? 'active' : '') + '" data-admin-action="tab" data-tab="schedule"><span class="ico">◷</span>Smart Schedule</button>' +
      '<button type="button" class="nav-btn ' + (adminTab === 'announcements' ? 'active' : '') + '" data-admin-action="tab" data-tab="announcements"><span class="ico">◈</span>Announcements</button>' +
      '<button type="button" class="nav-btn ' + (adminTab === 'backup' ? 'active' : '') + '" data-admin-action="tab" data-tab="backup"><span class="ico">⇩</span>Backup & Merge</button></nav>' +
      '<div class="sidebar-bottom"><div class="side-user"><span class="avatar sm">' + initials(state.user?.name) + '</span><span class="side-user-text"><strong>' + esc(state.user?.name) +
      '</strong><small>' + (organization ? 'School Administrator' : 'Site Administrator') + '</small></span><button class="icon-btn" type="button" data-admin-action="logout" aria-label="Sign Out" title="Sign Out">↪</button></div></div></aside>' +
      '<div class="main-area"><header class="topbar"><div class="row"><button class="mobile-menu" type="button" data-admin-action="toggle-menu" aria-label="Open Menu">☰</button>' +
      '<div class="breadcrumbs">Zhixing Learning / <b>Administration</b></div></div><span class="role-chip">' + (organization ? 'School Administrator' : 'Site Administrator') + '</span></header><main class="content">' + body +
      '<footer class="site-footer">Zhixing Learning · Site Administration</footer></main></div></div>' + passwordDialog() + deptDialog() + courseStudentsDialog();
  }

  render = function() {
    if (state.authMode === 'reset' && resetToken) {
      app.innerHTML = authRecoveryPage();
      return;
    }
    if (state.user?.role === 'admin') {
      startAdminLoad();
      if (state.page === 'detail' && state.selectedCourse) {
        const backBtn = '<div style="margin-bottom:12px"><button type="button" class="btn-text" data-admin-action="back-to-courses">← Back to Admin Course Management</button></div>';
        app.innerHTML = adminShell(backBtn + detailPage()) + modal();
        return;
      }
      app.innerHTML = adminShell();
      return;
    }
    if (!state.user && state.authMode === 'forgot') {
      app.innerHTML = authRecoveryPage();
      return;
    }
    if (!state.user) adminData = null;
    originalRender();
  };

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-admin-action]');
    if (!button) return;
    const action = button.dataset.adminAction;
    if ((action === 'close-dialog' || action === 'close-dept-dialog' || action === 'close-course-students') && button.classList.contains('modal-backdrop') && event.target !== button) return;
    event.preventDefault();
    if (action === 'forgot') {
      state.authMode = 'forgot'; state.authError = ''; resetNotice = ''; render(); return;
    }
    if (action === 'back-to-login') {
      resetToken = ''; resetNotice = ''; state.authMode = 'login'; state.authError = ''; render(); return;
    }
    if (action === 'tab') { adminTab = button.dataset.tab; state.page = 'admin'; state.selectedCourse = null; state.mobileOpen = false; render(); return; }
    if (action === 'back-to-courses') { adminTab = 'courses'; state.page = 'admin'; state.selectedCourse = null; render(); return; }
    if (action === 'manage-course') {
      run(async () => { await loadCourse(button.dataset.id); }, 'Could not open course: ');
      return;
    }
    if (action === 'toggle-menu') { state.mobileOpen = !state.mobileOpen; render(); return; }
    if (action === 'close-menu') { state.mobileOpen = false; render(); return; }
    if (action === 'close-dialog') { adminDialog = null; render(); return; }
    if (action === 'close-dept-dialog') { deptDialogUser = null; render(); return; }
    if (action === 'close-course-students') { courseStudentsModal = null; render(); return; }
    if (action === 'view-course-students') {
      courseStudentsModal = (adminData?.courses || []).find(c => c.id === button.dataset.id) || null;
      render();
      return;
    }
    if (action === 'duplicate-course') {
      const course = (adminData?.courses || []).find(c => c.id === button.dataset.id);
      if (!course || !confirm('Duplicate course "' + course.title + '"? Lessons, quizzes and assignments will be copied; student enrollments will not.')) return;
      run(async () => {
        await api('/api/admin/courses/' + encodeURIComponent(course.id) + '/duplicate', { method: 'POST' });
        adminData = await api('/api/admin/overview');
        render();
        showToast('Course duplicated');
      }, 'Could not duplicate course: ');
      return;
    }
    if (action === 'edit-course') {
      courseEditItem = (adminData?.courses || []).find(c => c.id === button.dataset.id) || null;
      render();
      return;
    }
    if (action === 'cancel-edit-course') { courseEditItem = null; render(); return; }
    if (action === 'delete-course') {
      if (!confirm('Delete this course and all its enrollments/quizzes/assignments?')) return;
      run(async () => { await api('/api/admin/courses/' + encodeURIComponent(button.dataset.id), { method: 'DELETE' }); if (courseEditItem?.id === button.dataset.id) courseEditItem = null; adminData = await api('/api/admin/overview'); render(); showToast('Course deleted'); }, 'Could not delete course: ');
      return;
    }
    if (action === 'assign-dept') {
      const source = (button.dataset.role === 'teacher' ? adminData?.teachers : adminData?.students) || [];
      const person = source.find(item => item.id === button.dataset.id);
      if (person) { deptDialogUser = person; render(); }
      return;
    }
    if (action === 'delete-dept') {
      if (!confirm('Remove this department from the list?')) return;
      run(async () => { await api('/api/admin/departments/' + encodeURIComponent(button.dataset.id), {method:'DELETE'}); adminData = await api('/api/admin/overview'); render(); showToast('Department removed'); }, 'Could not remove department: ');
      return;
    }
    if (action === 'edit-ann') {
      annEditItem = (adminData?.announcements || []).find(a => a.id === button.dataset.id) || null;
      render();
      return;
    }
    if (action === 'cancel-edit-ann') { annEditItem = null; render(); return; }
    if (action === 'delete-ann') {
      if (!confirm('Delete this announcement?')) return;
      run(async () => { await api('/api/admin/announcements/' + encodeURIComponent(button.dataset.id), {method:'DELETE'}); if (annEditItem?.id === button.dataset.id) annEditItem = null; adminData = await api('/api/admin/overview'); render(); showToast('Announcement deleted'); }, 'Could not delete announcement: ');
      return;
    }
    if (action === 'reload') { adminError = ''; adminData = null; render(); return; }
    if (action === 'logout') {
      run(async () => { await api('/api/auth/logout', {method:'POST'}); state.user = null; state.authRole = 'student'; state.authMode = 'login'; adminData = null; adminDialog = null; render(); showToast('You have signed out'); });
      return;
    }
    if (action === 'password') {
      const source = (button.dataset.role === 'teacher' ? adminData?.teachers : adminData?.students) || [];
      const person = source.find(item => item.id === button.dataset.id);
      if (person) { adminDialog = {id:person.id,name:person.name,role:button.dataset.role}; render(); }
      return;
    }
    if (action === 'approve-teacher' || action === 'reject-teacher') {
      const verb = action === 'approve-teacher' ? 'approve' : 'reject';
      run(async () => {
        await api('/api/admin/teacher-requests/' + encodeURIComponent(button.dataset.id) + '/' + verb, {method:'POST'});
        adminData = await api('/api/admin/overview');
        render();
        showToast(verb === 'approve' ? 'Instructor approved and linked to school' : 'Request declined');
      }, 'Could not update request: ');
      return;
    }
    if (action === 'restore-teacher') {
      run(async () => { await api('/api/admin/teachers/' + encodeURIComponent(button.dataset.id) + '/restore', { method: 'POST' }); adminData = await api('/api/admin/overview'); render(); showToast('Instructor account restored'); }, 'Could not restore instructor: ');
      return;
    }
    if (action === 'delete-teacher-permanent') {
      const teacher = (adminData?.teachers || []).find(t => t.id === button.dataset.id);
      if (!teacher || !confirm('Permanently delete ' + teacher.name + '? This will remove the account and release its account ID/email.')) return;
      run(async () => { await api('/api/admin/teachers/' + encodeURIComponent(teacher.id) + '/permanent', { method: 'DELETE' }); adminData = await api('/api/admin/overview'); render(); showToast('Instructor account permanently deleted'); }, 'Could not delete instructor: ');
      return;
    }
    if (action === 'remove-teacher') {
      const teacher = (adminData?.teachers || []).find(t => t.id === button.dataset.id);
      if (!teacher || !confirm('Deactivate ' + teacher.name + '? They will no longer be able to sign in. Their courses and student records will be kept.')) return;
      run(async () => { await api('/api/admin/teachers/' + encodeURIComponent(teacher.id), {method:'DELETE'}); adminData = await api('/api/admin/overview'); render(); showToast('Instructor account deactivated'); }, 'Could not deactivate instructor: ');
      return;
    }
    if (action === 'remove-enrollment') {
      const student = (adminData?.students || []).find(s => s.id === button.dataset.studentId);
      const enrollment = student?.enrollments?.find(e => e.courseId === button.dataset.courseId);
      if (!student || !enrollment || !confirm('Remove ' + student.name + ' from ' + enrollment.courseTitle + '?')) return;
      run(async () => { await api('/api/admin/students/' + encodeURIComponent(student.id) + '/enrollments/' + encodeURIComponent(enrollment.courseId), {method:'DELETE'}); adminData = await api('/api/admin/overview'); if (courseStudentsModal) courseStudentsModal = (adminData?.courses || []).find(c => c.id === courseStudentsModal.id) || null; render(); showToast('Student removed from course'); }, 'Could not update enrollment: ');
    }
  });

  // Handle administrator sign-in and school creation before the shared auth form listener.
  document.addEventListener('submit', event => {
    if (event.target.id !== 'auth-form' || state.authMode !== 'register' || state.authRole !== 'admin') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const values = Object.fromEntries(new FormData(event.target));
    run(async () => {
      try {
        const registering = state.authMode === 'register';
        const result = registering
          ? await api('/api/auth/register-admin', {method:'POST',body:JSON.stringify(values)})
          : await api('/api/auth/login', {method:'POST',body:JSON.stringify({email:values.email,password:values.password})});
        if (result.user?.role !== 'admin') {
          await api('/api/auth/logout', {method:'POST'});
          throw new Error('This account is not a site administrator.');
        }
        state.user = result.user; state.authError = ''; adminData = null; adminError = ''; state.page = 'admin'; render();
        showToast((registering ? 'Organization created. Welcome, ' : 'Welcome back, ') + state.user.name + '!');
      } catch (error) { state.authError = error.message; render(); }
    });
  }, true);

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!['admin-reset-request','admin-reset-confirm','admin-add-teacher','admin-password-form','admin-import-student-form','admin-import-teacher-form','admin-add-dept-form','admin-dept-form','admin-announcement-form','admin-backup-merge-form','admin-course-form','admin-course-add-students-form','admin-course-remove-students-form'].includes(form.id) && !form.classList.contains('admin-enrollment-form')) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (form.id === 'admin-reset-request') {
      run(async () => {
        try {
          const result = await api('/api/auth/forgot-password', {method:'POST',body:JSON.stringify({email:values.email})});
          resetNotice = result.message || 'If an account uses this email address, a reset link will be sent.';
        } catch (error) { resetNotice = error.message; }
        render();
      });
      return;
    }
    if (form.id === 'admin-reset-confirm') {
      if (values.password !== values.confirm) { showToast('Passwords do not match', true); return; }
      run(async () => {
        await api('/api/auth/reset-password', {method:'POST',body:JSON.stringify({token:resetToken,password:values.password})});
        resetToken = ''; resetNotice = ''; state.user = null; state.authMode = 'login'; state.authRole = 'student'; render();
        showToast('Password updated. You can sign in now.');
      }, 'Could not reset password: ');
      return;
    }
    if (state.user?.role !== 'admin') return;
    if (form.id === 'admin-import-student-form' || form.id === 'admin-import-teacher-form') {
      const role = form.id === 'admin-import-student-form' ? 'student' : 'teacher';
      const fileInput = form.querySelector('input[type="file"]');
      const file = fileInput?.files?.[0];
      if (!file) { showToast('Please choose a CSV file first', true); return; }
      run(async () => {
        const fileName = file.name || '';
        const lowerName = fileName.toLowerCase();
        if (lowerName.endsWith('.xls')) {
          showToast('Old .xls format is not supported. Please save it as .xlsx or .csv first.', true);
          return;
        }
        const isXlsx = lowerName.endsWith('.xlsx') || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const payload = { role, fileName, contentType: file.type || '' };
        if (isXlsx) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = '';
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
          }
          payload.contentBase64 = btoa(binary);
        } else {
          payload.csv = await file.text();
        }
        const result = await api('/api/admin/import', { method: 'POST', body: JSON.stringify(payload) });
        adminData = await api('/api/admin/overview');
        render();
        showToast('Imported ' + n(result.importedCount) + ' ' + role + ' account(s)');
      }, 'Import failed: ');
      return;
    }
    if (form.id === 'admin-backup-merge-form') {
      const file = form.querySelector('input[type="file"]')?.files?.[0];
      if (!file) { showToast('Please choose a JSON backup file first', true); return; }
      run(async () => {
        const text = await file.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch { throw new Error('Invalid JSON backup file'); }
        const res = await api('/api/admin/backup/merge', { method: 'POST', body: JSON.stringify({ backup: parsed }) });
        adminData = await api('/api/admin/overview');
        render();
        const m = res.merged || {};
        showToast('Merged: ' + n(m.users) + ' account(s), ' + n(m.courses) + ' course(s), ' + n(m.announcements) + ' announcement(s)');
      }, 'Merge failed: ');
      return;
    }
    if (form.id === 'admin-course-form') {
      const teacherIds = [...form.querySelectorAll('input[name="teacherIds"]:checked')].map(el => el.value);
      if (!teacherIds.length) { showToast('Select at least one instructor', true); return; }
      const editId = form.dataset.id;
      const targetDepartments = [...form.querySelectorAll('input[name="targetDepartments"]:checked')].map(el => el.value);
      const targetMajors = String(values.targetMajorsText || '').split(/[,，;；]/).map(x => x.trim()).filter(Boolean);
      const payload = {
        title: values.title, category: values.category, description: values.description,
        academicYear: values.academicYear || '', targetDepartments, targetMajors,
        autoEnroll: Boolean(form.querySelector('input[name="autoEnroll"]')?.checked),
        teacherIds, ...(values.enrollmentCode?.trim() ? { enrollmentCode: values.enrollmentCode.trim() } : {})
      };
      run(async () => {
        const res = editId
          ? await api('/api/admin/courses/' + encodeURIComponent(editId), { method: 'PATCH', body: JSON.stringify(payload) })
          : await api('/api/admin/courses', { method: 'POST', body: JSON.stringify(payload) });
        courseEditItem = null;
        adminData = await api('/api/admin/overview');
        render();
        showToast((editId ? 'Course updated' : 'Course created') + (res.autoEnrolledCount ? ' · ' + res.autoEnrolledCount + ' student(s) auto-enrolled' : ''));
      }, 'Could not save course: ');
      return;
    }
    if (form.id === 'admin-add-dept-form') {
      run(async () => {
        await api('/api/admin/departments', { method: 'POST', body: JSON.stringify({ name: values.name }) });
        adminData = await api('/api/admin/overview'); render(); showToast('Department added');
      }, 'Could not add department: ');
      return;
    }
    if (form.id === 'admin-dept-form') {
      run(async () => {
        await api('/api/admin/users/' + encodeURIComponent(form.dataset.id) + '/department', { method: 'PATCH', body: JSON.stringify({ department: values.department, major: values.major }) });
        deptDialogUser = null;
        adminData = await api('/api/admin/overview'); render(); showToast('Department assignment updated');
      }, 'Could not update department: ');
      return;
    }
    if (form.id === 'admin-announcement-form') {
      const editId = form.dataset.id;
      run(async () => {
        if (editId) {
          await api('/api/admin/announcements/' + encodeURIComponent(editId), { method: 'PATCH', body: JSON.stringify({ category: values.category, title: values.title, content: values.content }) });
        } else {
          await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ category: values.category, title: values.title, content: values.content }) });
        }
        annEditItem = null;
        adminData = await api('/api/admin/overview'); render(); showToast(editId ? 'Announcement updated' : 'Announcement published');
      }, 'Could not save announcement: ');
      return;
    }
    if (form.id === 'admin-add-teacher') {
      run(async () => {
        await api('/api/admin/teachers', {method:'POST',body:JSON.stringify({name:values.name,email:values.email,password:values.password,position:values.position||'教师',department:values.department||''})});
        adminData = await api('/api/admin/overview'); render(); showToast('教师账户创建成功');
      }, '创建教师失败: ');
      return;
    }
    if (form.id === 'admin-password-form') {
      if (values.password !== values.confirm) { showToast('Passwords do not match', true); return; }
      run(async () => {
        await api('/api/admin/users/' + encodeURIComponent(form.dataset.id) + '/password', {method:'PATCH',body:JSON.stringify({password:values.password})});
        adminDialog = null; render(); showToast('Password updated');
      }, 'Could not update password: ');
      return;
    }
    if (form.classList.contains('admin-enrollment-form')) {
      const student = (adminData?.students || []).find(s => s.id === form.dataset.studentId);
      const course = (adminData?.courses || []).find(c => c.id === values.courseId);
      if (!student || !course || !confirm('Add ' + student.name + ' to ' + course.title + '?')) return;
      run(async () => {
        await api('/api/admin/students/' + encodeURIComponent(student.id) + '/enrollments/' + encodeURIComponent(course.id), {method:'POST'});
        adminData = await api('/api/admin/overview'); render(); showToast('Student added to course');
      }, 'Could not update enrollment: ');
      return;
    }
    if (form.id === 'admin-course-add-students-form' || form.id === 'admin-course-remove-students-form') {
      const courseId = form.dataset.courseId;
      const isAdd = form.id === 'admin-course-add-students-form';
      const fieldName = isAdd ? 'studentIds' : 'removeStudentIds';
      const ids = new FormData(form).getAll(fieldName).map(String);
      if (!ids.length) { showToast(isAdd ? 'Please select at least one student' : 'Please select at least one student to remove', true); return; }
      const course = (adminData?.courses || []).find(c => c.id === courseId);
      if (!course) return;
      if (!confirm((isAdd ? 'Add ' : 'Remove ') + ids.length + ' student(s) ' + (isAdd ? 'to' : 'from') + ' ' + course.title + '?')) return;
      run(async () => {
        for (const studentId of ids) {
          await api('/api/admin/students/' + encodeURIComponent(studentId) + '/enrollments/' + encodeURIComponent(courseId), { method: isAdd ? 'POST' : 'DELETE' });
        }
        adminData = await api('/api/admin/overview');
        courseStudentsModal = (adminData?.courses || []).find(c => c.id === courseId) || null;
        render();
        showToast((isAdd ? 'Added ' : 'Removed ') + ids.length + ' student(s)');
      }, 'Could not update course enrollment: ');
    }
  });

  function applyAdminFilter(el, refocus) {
    const key = el.dataset.adminFilter;
    const val = el.value;
    if (key === 'teacher-q') teacherFilter.q = val;
    else if (key === 'teacher-department') teacherFilter.department = val;
    else if (key === 'teacher-major') teacherFilter.major = val;
    else if (key === 'teacher-status') teacherFilter.status = val;
    else if (key === 'teacher-position') teacherFilter.position = val;
    else if (key === 'student-q') studentFilter.q = val;
    else if (key === 'student-department') studentFilter.department = val;
    else if (key === 'student-major') studentFilter.major = val;
    else if (key === 'student-gender') studentFilter.gender = val;
    else if (key === 'course-q') courseFilter.q = val;
    else if (key === 'course-department') { courseFilter.department = val; courseFilter.teacherId = ''; }
    else if (key === 'course-teacher') courseFilter.teacherId = val;
    else if (key === 'course-year') courseFilter.academicYear = val;
    else if (key === 'course-discipline') courseFilter.discipline = val;
    const pos = refocus ? el.selectionStart : null;
    const id = el.id;
    render();
    if (refocus && id) {
      const nextEl = document.getElementById(id);
      if (nextEl) { nextEl.focus(); if (pos != null) nextEl.setSelectionRange(pos, pos); }
    }
  }
  document.addEventListener('input', event => {
    if (event.target.dataset?.adminFilter && event.target.type === 'search') applyAdminFilter(event.target, true);
  });
  document.addEventListener('change', event => {
    const teacherId = event.target.dataset?.adminTeacherPos;
    if (teacherId) {
      const position = event.target.value;
      run(async () => {
        await api('/api/admin/teachers/' + encodeURIComponent(teacherId) + '/position', { method: 'PATCH', body: JSON.stringify({ position }) });
        adminData = await api('/api/admin/overview');
        render();
        showToast('已更新该教师职位为：' + position);
      }, '更新职位失败: ');
      return;
    }
    if (event.target.dataset?.adminFilter && event.target.tagName === 'SELECT') applyAdminFilter(event.target, false);
  });
})();
