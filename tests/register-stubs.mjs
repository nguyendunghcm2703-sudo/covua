// Cho phép test lớp Durable Object bằng Node: giả lập module "cloudflare:workers".
import { register } from 'node:module';

register('./stub-hooks.mjs', import.meta.url);
