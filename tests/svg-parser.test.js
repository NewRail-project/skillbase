import { createIcon } from '../shared/svg.js';

const tests = [
  { name: 'Correct path', icon: '<svg viewBox="0 0 24 24"><path d="M10 10h10v10H10z"/></svg>', pass: true },
  { name: 'Polyline', icon: '<svg viewBox="0 0 24 24"><polyline points="1 1 2 2"/></svg>', pass: true },
  { name: 'Multiple children', icon: '<svg viewBox="0 0 24 24"><path d="M1 1z"/><circle cx="1" cy="1" r="1"/></svg>', pass: true },
  { name: 'Script rejection', icon: '<svg><script>alert(1)</script></svg>', pass: false },
  { name: 'Onload rejection', icon: '<svg onload="alert(1)"></svg>', pass: false },
  { name: 'Unknown tag rejection', icon: '<svg><foreignObject>...</foreignObject></svg>', pass: false },
  { name: 'Broken structure', icon: '<svg><path d="123"', pass: false }
];

tests.forEach(t => {
  try {
    const el = createIcon(t.icon);
    if (!t.pass) console.error(`FAIL: ${t.name} should have failed`);
    else console.log(`PASS: ${t.name}`);
  } catch (e) {
    if (t.pass) console.error(`FAIL: ${t.name} should have passed`);
    else console.log(`PASS: ${t.name} (caught: ${e.message})`);
  }
});