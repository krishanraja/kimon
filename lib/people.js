// The family list, from Vercel env PEOPLE (kept out of this public repo).
import { parseRoster } from '../public/js/people.js';

export function roster() { return parseRoster(process.env.PEOPLE || '[]'); }
