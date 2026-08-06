// Quick test - load saju engine as a module
const fs = require('fs');

// Read the engine code and wrap it to capture the result
const engineCode = fs.readFileSync('saju-engine.js', 'utf-8');
const wrappedCode = engineCode + '\nmodule.exports = SajuEngine;';
fs.writeFileSync('_test_engine.js', wrappedCode);

const SajuEngine = require('./_test_engine.js');

try {
  console.log('SajuEngine type:', typeof SajuEngine);
  console.log('SajuEngine keys:', Object.keys(SajuEngine));
  
  const r = SajuEngine.calculate(1990, 5, 15, 9, 'male');
  console.log('\n=== Pillars ===');
  r.pillars.forEach((p, i) => console.log(`  [${i}] ${p.gan} ${p.ji}`));
  console.log('\n=== Ohaeng Count ===');
  console.log(' ', JSON.stringify(r.ohaengCount));
  console.log('\n=== Ilgan ===', r.ilgan, r.ilganOhaeng, r.ilganYinyang);
  console.log('=== Ddi ===', r.ddi, r.ddiEmoji);

  console.log('\n--- Testing generateInterpretation (7 Accordion Sections) ---');
  const interp = SajuEngine.generateInterpretation(r, '김민수', 'male');
  let totalChars = 0;
  interp.forEach((sec, idx) => {
    const plainText = sec.content.replace(/<[^>]+>/g, '').trim();
    totalChars += plainText.length;
    console.log(`  [Sec ${idx + 1}] Icon: ${sec.icon} | Title: "${sec.title}" | HTML: ${sec.content.length} chars | Text: ${plainText.length} chars`);
  });
  console.log(`\n  Total Interpretation Pure Text: ${totalChars} chars across ${interp.length} sections!`);

  console.log('\n--- Testing generateDailyFortune ---');
  const fortune = SajuEngine.generateDailyFortune(0);
  console.log('  Overall:', fortune.overallLuckText);
  fortune.categories.forEach(c => console.log(`  ${c.name}: ${c.score}/5 - ${c.text.substring(0,40)}...`));

  console.log('\n✅ ALL TESTS PASSED - No errors found');
} catch (e) {
  console.error('\n❌ ERROR:', e.message);
  console.error(e.stack);
} finally {
  // Cleanup
  try { fs.unlinkSync('_test_engine.js'); } catch(e) {}
}
