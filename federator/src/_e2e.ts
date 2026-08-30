// eslint-disable-next-line @typescript-eslint/no-require-imports
const env = require(process.env.LOCAL_ENV as string) as NodeJS.ProcessEnv;
for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v as string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./main');
