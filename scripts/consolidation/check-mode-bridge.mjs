import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const source = fs.readFileSync(new URL('../../assets/js/analects-frame-bridge.js', import.meta.url));
const targets = process.argv.slice(2);
if (targets.length !== 2 || targets.some(target => !path.isAbsolute(target))) throw Error('two_absolute_ly_and_fuzi_checkout_paths_required');
for (const target of targets) {
    const bytes = fs.readFileSync(path.join(target, 'public/analects-frame-bridge.js'));
    if (!bytes.equals(source)) throw Error('generated_frame_bridge_drift');
}
console.log(JSON.stringify({ copiesVerified: 2, sha256: createHash('sha256').update(source).digest('hex') }));
