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
assert.match(html,/Student Portal/);
assert.match(html,/Instructor Portal/);
assert.match(html,/Admin Portal/);
assert.match(html,/Forgot password\?/);
assert.match(html,/you@example\.com/);
vm.runInContext("state.authRole='admin';render()",ui.context);
assert.match(ui.app.innerHTML,/Open Admin Dashboard/);
assert.match(ui.app.innerHTML,/Sign in with your administrator account/);
assert.match(ui.app.innerHTML,/Create School Administrator Account/);
vm.runInContext("state.authMode='register';render()",ui.context);
assert.match(ui.app.innerHTML,/Create a School Organization/);
assert.match(ui.app.innerHTML,/auth-school-name/);
assert.match(ui.app.innerHTML,/auth-school-code/);
vm.runInContext("state.authMode='login';state.authRole='student';state.authMode='register';render()",ui.context);
assert.match(ui.app.innerHTML,/School \/ Organization \(optional\)/);
vm.runInContext("state.authMode='login';state.authRole='admin';state.user=null;render()",ui.context);
assert.match(ui.app.innerHTML,/Admin Portal/);
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
