/* Separate slow illumination from surface detail: move light, not plaster or floor. */
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const scenes = [];
  const vertex = `attribute vec2 position; varying vec2 uv;
    void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
  const fragment = `precision mediump float;
    varying vec2 uv; uniform sampler2D photo; uniform sampler2D light;
    uniform float time; uniform float aspect; uniform float curtain; uniform float interior; uniform float shadowEnd; uniform float horizon;
    float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
    void main(){
      vec2 cover=aspect<3.?vec2(aspect/3.,1.):vec2(1.,3./aspect);
      vec2 p=(uv-.5)*cover+.5;
      if(interior>.5 && aspect<2.)p.x+=(1.-cover.x)*.32;
      float breeze=sin(time*.72); float second=sin(time*.57);
      // The photo texture stays at p. Only its low-frequency illumination shifts.
      vec2 drift=mix(vec2(.022*breeze,.026*second),vec2(.028*breeze,.016*second),curtain);
      float start=smoothstep(.25,.42,p.x);
      float objectEdge=mix(.92,.85,curtain);
      float wall=start*(1.-smoothstep(objectEdge-.08,objectEdge,p.x));
      if(curtain<.5)wall*=smoothstep(.10,.20,p.y);
      if(interior>.5){wall=start*(1.-smoothstep(shadowEnd-.06,shadowEnd,p.x));wall*=smoothstep(.012,.035,abs(p.y-horizon));}
      float originalLight=luma(texture2D(light,p).rgb);
      float movedLight=luma(texture2D(light,p+drift).rgb);
      float ratio=clamp(movedLight/max(originalLight,.08),.70,1.40);
      // A tiny, smooth flex at the outer fabric/leaves; never distort the room.
      float edge=smoothstep(.86,.98,p.x);
      if(curtain<.5)edge*=smoothstep(.45,.7,p.y);
      if(interior>.5)edge=smoothstep(.955,.99,p.x);
      vec2 objectShift=vec2(.0008*breeze*(1.-p.y),.0004*second)*edge;
      vec3 detail=texture2D(photo,p+objectShift).rgb;
      gl_FragColor=vec4(detail*mix(1.,ratio,wall),1.);
    }`;
  const compile = (gl, type, source) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Scene shader unavailable');
    return shader;
  };
  const create = async svg => {
    const host=svg.parentElement, img=new Image();
    img.src=svg.querySelector('image').getAttribute('href');
    try { await img.decode(); } catch { return; }
    const canvas=document.createElement('canvas'); canvas.className='living-light-canvas'; canvas.setAttribute('aria-hidden','true');
    const gl=canvas.getContext('webgl',{alpha:false,antialias:false,powerPreference:'low-power'});
    if(!gl)return;
    try {
      const program=gl.createProgram();gl.attachShader(program,compile(gl,gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl,gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))return;
      gl.useProgram(program);
      const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      // Blur only for illumination analysis. The displayed material retains full detail.
      const illumination=document.createElement('canvas');illumination.width=1086;illumination.height=362;
      const context=illumination.getContext('2d');context.drawImage(img,0,0,1086,362);context.filter='blur(3px)';context.drawImage(img,-8,-8,1102,378);
      [img,illumination].forEach((source,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,source);gl.uniform1i(gl.getUniformLocation(program,i?'light':'photo'),i);});
      const time=gl.getUniformLocation(program,'time'),aspect=gl.getUniformLocation(program,'aspect');
      gl.uniform1f(gl.getUniformLocation(program,'curtain'),svg.dataset.sceneKind==='curtain'||svg.dataset.sceneKind==='interior'?1:0);
      gl.uniform1f(gl.getUniformLocation(program,'interior'),svg.dataset.sceneKind==='interior'?1:0);
      gl.uniform1f(gl.getUniformLocation(program,'shadowEnd'),Number(svg.dataset.shadowEnd||.70));
      gl.uniform1f(gl.getUniformLocation(program,'horizon'),Number(svg.dataset.horizon||.315));
      let seconds=0,last=0,frame=0,visible=false;
      const render=()=>{const rect=host.getBoundingClientRect();const dpr=Math.min(devicePixelRatio,1.5);const width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);if(!width||!height)return;if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);}gl.uniform1f(aspect,rect.width/rect.height);gl.uniform1f(time,seconds);gl.drawArrays(gl.TRIANGLES,0,6);};
      const tick=now=>{frame=0;if(last)seconds+=(now-last)/1000;last=now;render();frame=requestAnimationFrame(tick);};
      const update=()=>{cancelAnimationFrame(frame);frame=0;last=0;canvas.hidden=preference.matches;if(visible&&!document.hidden&&!preference.matches){render();frame=requestAnimationFrame(tick);}};
      const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;update();},{threshold:.01});
      host.append(canvas);observer.observe(host);scenes.push(update);
      canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();cancelAnimationFrame(frame);canvas.remove();observer.disconnect();});
      canvas.addEventListener('webglcontextrestored',()=>location.reload(),{once:true});
      new ResizeObserver(()=>{if(visible&&!preference.matches)render();}).observe(host);
    } catch { canvas.remove(); }
  };
  document.querySelectorAll('[data-living-surface]').forEach(create);
  preference.addEventListener('change',()=>scenes.forEach(update=>update()));
  document.addEventListener('visibilitychange',()=>scenes.forEach(update=>update()));
})();
