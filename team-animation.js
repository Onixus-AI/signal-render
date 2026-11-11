import {createHash} from 'node:crypto';
const HASHES={
 wave:'0802ba02b04d89100c54d4b8fade04a15753f7f3c37ceb97398646ea8c545e60',
 handle:'10aa0e15ea5a8383ae9d296fe5a859f587e7ac536c7a40c69aeb100010a9bd22',
 point:'00376cb70a2f55f4de256786d815f3cf06ef4c52250cea38900d7f8b33f9349e',
};
export function verifyTeamClip(character,move,bytes){
 if(character!=='onyx'||!HASHES[move])throw new Error('Unreviewed animated character action');
 if(createHash('sha256').update(Buffer.from(bytes)).digest('hex')!==HASHES[move])throw new Error('Approved character clip changed; inspect and review its identity before rendering');
}
