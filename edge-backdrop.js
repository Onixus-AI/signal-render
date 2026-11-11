/** Remove only studio-backdrop pixels connected to an edge. Enclosed bright
 * reflections on the approved character stay opaque instead of becoming holes. */
export function keyConnectedBackdrop(p,width,height,key){
 const count=width*height,seen=new Uint8Array(count),queue=new Uint32Array(count);let head=0,tail=0;
 const distance=(n)=>Math.hypot(p[n*4]-key[0],p[n*4+1]-key[1],p[n*4+2]-key[2])/441.673;
 const visit=(n)=>{if(n<0||n>=count||seen[n])return;seen[n]=1;if(distance(n)<.26)queue[tail++]=n;};
 for(let x=0;x<width;x++){visit(x);visit((height-1)*width+x);}
 for(let y=0;y<height;y++){visit(y*width);visit(y*width+width-1);}
 while(head<tail){const n=queue[head++],x=n%width;p[n*4+3]=Math.round(p[n*4+3]*Math.max(0,Math.min(1,(distance(n)-.18)/.08)));
  if(x>0)visit(n-1);if(x<width-1)visit(n+1);if(n>=width)visit(n-width);if(n<count-width)visit(n+width);
 }
 return p;
}
