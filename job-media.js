import {join} from 'node:path';

// These job-local artifacts are prepared by the worker, never caller paths.
const ALLOWED = /^(cine-clip-\d{1,2}\.mp4|star\.png|star-[a-z]{3,10}\.webm|team-onyx-(wave|handle|point)\.webm)$/;
export function jobMediaHandler(roots) {
  return (req,res) => {
    const dir=roots.get(String(req.params.token));
    const name=String(req.params.name);
    if(!dir || !ALLOWED.test(name)) return res.status(404).end();
    return res.sendFile(join(dir,name));
  };
}
