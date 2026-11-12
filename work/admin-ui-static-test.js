// UI checks without opening a browser or contacting localhost.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function loadUi(search = '') {
  const app = { innerHTML: '' };
  const events = [];
  let replaced = false;
  const document = {
    querySelector: selector => selector === '#app' ? app : selector === '#toast-area' ? {append() {}} : null,
    addEventListener: (name, callback, capture) => events.push({name, callback, capture}),
  };
  const context = vm.createContext({
    document,
    location: {search,pathname:'/',hash:'',origin:'http://example.invalid'},
    history: {replaceState() { replaced = true; }},
    URLSearchParams,
    URL,
    console,
    fetch: () => new Promise(() => {}),
    setTimeout: () => {},
    window: {scrollTo() {}},
  });
  for (const file of ['public/app.js','public/v2.js','public/profile.js','public/admin.js']) {
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'), context, {filename:file});
  }
  return {context,app,events,get replaced(){return replaced;}};
}

const ui = loadUi();
let html = vm.runInContext('authPage()',ui.context);
assert.match(html,/Account ID or Email/);
assert.match(html,/Sign In/);
assert.doesNotMatch(html,/Student Portal|Instructor Portal|Admin Portal/);
assert.match(html,/Forgot password\?/);
assert.match(html,/you@example\.com/);
vm.runInContext("state.authMode='register';state.authRole='admin';render()",ui.context);
assert.match(ui.app.innerHTML,/<select id="auth-role-select"/);
assert.match(ui.app.innerHTML,/Create a School Organization/);
assert.match(ui.app.innerHTML,/Administrator Account ID/);
assert.match(ui.app.innerHTML,/SIU199901/);
assert.match(ui.app.innerHTML,/auth-school-name/);
assert.match(ui.app.innerHTML,/auth-school-code/);
vm.runInContext("state.authRole='teacher';render()",ui.context);
assert.match(ui.app.innerHTML,/Instructor Account ID/);
assert.match(ui.app.innerHTML,/tch202601/);
vm.runInContext("state.authRole='student';render()",ui.context);
assert.match(ui.app.innerHTML,/Student Account ID/);
assert.match(ui.app.innerHTML,/20260101/);
assert.match(ui.app.innerHTML,/School \/ Organization \(optional\)/);
vm.runInContext("state.user={id:'admin1',role:'admin',name:'Admin',email:'admin@example.com'};render()",ui.context);
assert.match(ui.app.innerHTML,/SITE ADMINISTRATION/);
assert.doesNotMatch(ui.app.innerHTML,/Student Space|Instructor Space/);
assert.ok(ui.events.some(item => item.name === 'submit' && item.capture === true),'admin capture listener registered');

const resetUi = loadUi('?reset=one-time-token');
assert.equal(resetUi.replaced,true,'token removed from URL immediately');
vm.runInContext('render()',resetUi.context);
assert.match(resetUi.app.innerHTML,/Set a New Password/);
assert.doesNotMatch(resetUi.app.innerHTML,/one-time-token/);
console.log('PASS: role selection, admin-only dashboard, generic recovery UI, reset token hidden from URL/UI');
