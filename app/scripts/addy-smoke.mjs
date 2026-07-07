import { chromium } from 'playwright-core';
const URL = process.env.SMOKE_URL || 'http://localhost:4750/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
let code = 0; const fail = (m) => { console.error('✗ ' + m); code = 1; };
// X only (no Y), 12 samples
const X = ['1000,1100,1200,1300', ...Array.from({length:12},(_,i)=>`${(0.3+i*0.02).toFixed(3)},0.4,${(0.5-i*0.01).toFixed(3)},0.35`)].join('\n');
// partial y: 10 values + 2 blank (missing) — same "size as X"
const Y = ['y','6.1','7.3','','8.9','5.5','6.8','7.1','','8.2','5.9','6.4','7.7'].join('\n');
try {
  await p.goto(URL,{waitUntil:'load'}); await p.waitForSelector('header img[alt="nirs4all"]');
  await p.getByRole('button',{name:/Nouveau projet|New project/}).click();
  await p.waitForSelector('input[type=file]',{state:'attached'});
  await p.locator('input[type=file]').first().setInputFiles({name:'X.csv',mimeType:'text/csv',buffer:Buffer.from(X)});
  await p.waitForTimeout(400);
  await p.getByRole('button',{name:/Créer le projet|Create project/}).click();
  await p.waitForSelector('[data-step-id="explore"]');
  let body = (await p.textContent('body'))||'';
  if (/0 avec référence|0 with a reference/.test(body)) console.log('✓ dataset created with 0 references'); else fail('expected 0 references initially');
  // Add y
  await p.getByRole('button',{name:/Ajouter y|Add y/}).click();
  await p.locator('input[type=file]').last().setInputFiles({name:'Y.csv',mimeType:'text/csv',buffer:Buffer.from(Y)});
  await p.waitForTimeout(500);
  body = (await p.textContent('body'))||'';
  if (/10 référence|10 reference/.test(body)) console.log('✓ 10 references added (2 missing skipped)'); else fail('references not added');
  if (/10 avec référence|10 with a reference/.test(body)) console.log('✓ header now shows 10 with reference'); else fail('header count not updated');
  // calibration now possible
  await p.locator('[data-step-id="calibrate"]').click();
  await p.waitForSelector('text=/Lancer la calibration/');
  const disabled = await p.getByRole('button',{name:/Lancer la calibration/}).isDisabled();
  if (!disabled) console.log('✓ calibration enabled after adding y'); else fail('calibration still disabled');
} catch(e){ fail('exception: '+(e instanceof Error?e.message:String(e))); }
finally { await b.close(); console.log(code===0?'\n✅ ADD-Y smoke PASSED':'\n❌ ADD-Y smoke FAILED'); process.exit(code); }
