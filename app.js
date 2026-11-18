'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const storageKey = 'medsolution_ar_measurements_v1';
  const modeLabels = {length: 'Distancia', area: 'Área', perimeter: 'Perímetro'};
  const dashboard = $('dashboard');
  const overlay = $('ar-ui');
  const canvas = $('xr-canvas');
  let mode = 'length';
  let session = null;
  let refSpace = null;
  let hitSource = null;
  let gl = null;
  let renderer = null;
  let lastHit = null;
  let points = [];
  let records = [];
  let noticeTimer;
  try { const data = JSON.parse(localStorage.getItem(storageKey) || '[]'); records = Array.isArray(data) ? data : []; } catch { records = []; }

  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  const toLength = meters => meters < 1 ? `${(meters * 100).toFixed(1)} cm` : `${meters.toFixed(2)} m`;
  const toArea = sqm => sqm < 1 ? `${(sqm * 10000).toFixed(0)} cm²` : `${sqm.toFixed(2)} m²`;
  const sumDistance = (arr, closed) => {
    let n = 0;
    for (let i = 1; i < arr.length; i++) n += distance(arr[i-1],arr[i]);
    if (closed && arr.length > 2) n += distance(arr[arr.length-1],arr[0]);
    return n;
  };
  // Método de Newell: área aproximada de un polígono 3D casi coplanar.
  const polygonArea = arr => {
    if (arr.length < 3) return 0;
    let nx=0,ny=0,nz=0;
    for(let i=0;i<arr.length;i++) {
      const a=arr[i], b=arr[(i+1)%arr.length];
      nx+=(a.y-b.y)*(a.z+b.z);
      ny+=(a.z-b.z)*(a.x+b.x);
      nz+=(a.x-b.x)*(a.y+b.y);
    }
    return 0.5*Math.hypot(nx,ny,nz);
  };
  const required = () => mode === 'length' ? 2 : 3;
  const valueFor = () => mode === 'area' ? polygonArea(points) : sumDistance(points,mode === 'perimeter');
  const format = n => mode === 'area' ? toArea(n) : toLength(n);
  const supported = () => navigator.xr && typeof navigator.xr.isSessionSupported === 'function';

  function showNotice(message) {
    clearTimeout(noticeTimer);
    document.querySelector('.toast')?.remove();
    const toast=document.createElement('div');toast.className='toast';toast.textContent=message;
    document.body.appendChild(toast);
    noticeTimer=setTimeout(() => toast.remove(), 3500);
  }
  function persist() {
    try {localStorage.setItem(storageKey,JSON.stringify(records));return true;}
    catch {showNotice('No se pudo almacenar en este dispositivo.');return false;}
  }
  function renderRecords() {
    const list=$('records');list.replaceChildren();
    $('export').disabled=records.length === 0;
    if (!records.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Aún no hay medidas guardadas. Inicia una medición para comenzar.';list.appendChild(empty);return;}
    for (const r of records){
      const card=document.createElement('div');card.className='record';
      const left=document.createElement('div');const heading=document.createElement('strong');heading.textContent=r.name;
      const detail=document.createElement('p');detail.textContent=`${new Date(r.date).toLocaleString('es-BO',{timeZone:'America/La_Paz',dateStyle:'medium',timeStyle:'short'})} · ${r.points} puntos`;
      left.append(heading,detail);
      const right=document.createElement('div');right.className='record-right';
      const amount=document.createElement('span');amount.className='record-val';amount.textContent=r.formatted;
      const del=document.createElement('button');del.className='trash';del.textContent='✕';del.type='button';del.title='Eliminar medición';del.setAttribute('aria-label',`Eliminar ${r.name}`);
      del.addEventListener('click',()=>{if(confirm('¿Eliminar esta medición guardada?')){records=records.filter(v=>v.id!==r.id);persist();renderRecords();}});
      right.append(amount,del);card.append(left,right);list.appendChild(card);
    }
  }
  function updateControls() {
    $('ar-count').textContent=`${points.length} ${points.length===1?'punto':'puntos'}`;
    const valid=points.length>=required();
    $('save').disabled=!valid;
    $('undo').disabled=points.length===0;
    $('mark').disabled=!lastHit || (mode==='length' && points.length===2);
    $('result-label').textContent=mode==='area'?'Superficie aproximada':mode==='perimeter'?'Perímetro aproximado':'Distancia aproximada';
    $('result').textContent=valid?format(valueFor()):'—';
    $('ar-tip').textContent=valid?(mode==='length'?'Puedes guardar esta medida o deshacer un punto.':'Puedes agregar más vértices o guardar la medida.'):`Marca ${required()-points.length} ${required()-points.length===1?'punto más':'puntos más'} sobre la superficie.`;
  }
  function trackStatus(ok) {
    $('reticle').classList.toggle('ready',ok);
    $('tracking').textContent=ok?'Superficie detectada':'Buscando superficies...';
    $('ar-hint').textContent=ok?'Apunta al punto que deseas marcar.':'Mueve lentamente el celular y busca una superficie bien iluminada.';
    $('mark').disabled=!ok || (mode==='length' && points.length===2);
  }

  // WebGL dibuja líneas y marcadores en posiciones reales dentro de la sesión WebXR.
  function initRenderer(g) {
    const vertex=`attribute vec3 aPosition;uniform mat4 uMvp;uniform float uPointSize;void main(){gl_Position=uMvp*vec4(aPosition,1.0);gl_PointSize=uPointSize;}`;
    const fragment=`precision mediump float;uniform vec4 uColor;uniform bool uRound;void main(){if(uRound && distance(gl_PointCoord,vec2(0.5))>0.5) discard;gl_FragColor=uColor;}`;
    function compile(type,source) {const shader=g.createShader(type);g.shaderSource(shader,source);g.compileShader(shader);if(!g.getShaderParameter(shader,g.COMPILE_STATUS))throw new Error(g.getShaderInfoLog(shader)||'Error shader');return shader;}
    const program=g.createProgram();g.attachShader(program,compile(g.VERTEX_SHADER,vertex));g.attachShader(program,compile(g.FRAGMENT_SHADER,fragment));g.linkProgram(program);
    if(!g.getProgramParameter(program,g.LINK_STATUS))throw new Error(g.getProgramInfoLog(program)||'Error WebGL');
    return {program,position:g.getAttribLocation(program,'aPosition'),mvp:g.getUniformLocation(program,'uMvp'),size:g.getUniformLocation(program,'uPointSize'),color:g.getUniformLocation(program,'uColor'),round:g.getUniformLocation(program,'uRound'),buffer:g.createBuffer()};
  }
  function matrixMultiply(a,b) {
    const out=new Float32Array(16);
    for(let c=0;c<4;c++)for(let r=0;r<4;r++)out[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];
    return out;
  }
  function drawGeometry(view) {
    if(!points.length || !renderer)return;
    const mvp=matrixMultiply(view.projectionMatrix,view.transform.inverse.matrix);
    const obj=renderer;
    gl.useProgram(obj.program);
    gl.uniformMatrix4fv(obj.mvp,false,mvp);
    gl.bindBuffer(gl.ARRAY_BUFFER,obj.buffer);
    gl.enableVertexAttribArray(obj.position);
    gl.vertexAttribPointer(obj.position,3,gl.FLOAT,false,0,0);
    const coord=new Float32Array(points.flatMap(p=>[p.x,p.y,p.z]));
    gl.bufferData(gl.ARRAY_BUFFER,coord,gl.DYNAMIC_DRAW);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(obj.size,12);gl.uniform1i(obj.round,0);
    gl.uniform4f(obj.color,0.34,0.97,0.84,1);
    if(points.length>=2){gl.lineWidth(3);gl.drawArrays(mode==='length'?gl.LINE_STRIP:gl.LINE_STRIP,0,points.length);
      if(mode!=='length'&&points.length>=3){const poly=points.flatMap(p=>[p.x,p.y,p.z]);poly.push(points[0].x,points[0].y,points[0].z);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(poly),gl.DYNAMIC_DRAW);gl.drawArrays(gl.LINE_STRIP,0,points.length+1);gl.bufferData(gl.ARRAY_BUFFER,coord,gl.DYNAMIC_DRAW);}
    }
    gl.uniform1i(obj.round,1);gl.uniform4f(obj.color,0.3,1,0.82,1);gl.drawArrays(gl.POINTS,0,points.length);
  }

  function onFrame(time,frame) {
    if(!session)return;
    session.requestAnimationFrame(onFrame);
    const pose=frame.getViewerPose(refSpace);
    let hit=null;
    try {
      const hits=hitSource?frame.getHitTestResults(hitSource):[];
      if(hits.length){const p=hits[0].getPose(refSpace);if(p)hit={x:p.transform.position.x,y:p.transform.position.y,z:p.transform.position.z};}
    } catch {/* La detección puede perderse momentáneamente */}
    const hadHit=!!lastHit;lastHit=hit;
    if(hadHit!==!!hit)trackStatus(!!hit);
    if(!pose)return;
    const layer=session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    for(const view of pose.views){const vp=layer.getViewport(view);gl.viewport(vp.x,vp.y,vp.width,vp.height);drawGeometry(view);}
  }
  async function startAR() {
    if(session)return;
    if(!supported()){showNotice('Este navegador no dispone de WebXR. Abre la PWA con Chrome en Android compatible.');return;}
    overlay.hidden=false;
    $('ar-mode-label').textContent=modeLabels[mode];
    points=[];lastHit=null;updateControls();trackStatus(false);
    let requested;
    try {
      // Es esencial solicitar la sesión directamente desde el gesto del usuario.
      requested=navigator.xr.requestSession('immersive-ar',{
        requiredFeatures:['hit-test','dom-overlay'],
        optionalFeatures:['local-floor'],
        domOverlay:{root:overlay}
      });
      session=await requested;
      gl=canvas.getContext('webgl',{alpha:true,antialias:true,xrCompatible:true});
      if(!gl)throw new Error('WebGL no está disponible.');
      await gl.makeXRCompatible();
      renderer=initRenderer(gl);
      await session.updateRenderState({baseLayer:new XRWebGLLayer(session,gl,{alpha:true,depth:true,stencil:false})});
      refSpace=await session.requestReferenceSpace('local');
      const viewerSpace=await session.requestReferenceSpace('viewer');
      hitSource=await session.requestHitTestSource({space:viewerSpace});
      session.addEventListener('end',resetSession,{once:true});
      canvas.classList.add('active');
      session.requestAnimationFrame(onFrame);
    }catch(err){
      const msg=(err && err.message)||'No se pudo iniciar la cámara AR.';
      showNotice(`No se pudo iniciar AR: ${msg}`);
      if(session){const active=session;resetSession();try{await active.end();}catch{}}
      else resetSession();
    }
  }
  function resetSession(){session=null;hitSource=null;refSpace=null;lastHit=null;points=[];renderer=null;overlay.hidden=true;canvas.classList.remove('active');renderRecords();}
  function addPoint(){if(!session||!lastHit)return;if(mode==='length'&&points.length>=2)return;points.push({...lastHit});updateControls();}
  function saveMeasurement(){
    if(points.length<required())return;
    const n=valueFor();if(!Number.isFinite(n)||n<=0){showNotice('Marca puntos diferentes para obtener una medida válida.');return;}
    const id=(globalThis.crypto?.randomUUID?.())||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const name=`${modeLabels[mode]} ${records.filter(r=>r.mode===mode).length+1}`;
    records.unshift({id,mode,name,date:new Date().toISOString(),value:n,formatted:format(n),points:points.length,coordinates:points.map(p=>({...p}))});
    if(persist())showNotice('Medición guardada en este dispositivo.');
    points=[];updateControls();
  }
  function exportCSV(){
    if(!records.length)return;
    const rows=[['Tipo','Nombre','Fecha ISO','Resultado','Valor SI','Unidad','Puntos'],...records.map(r=>[modeLabels[r.mode]||r.mode,r.name,r.date,r.formatted,r.value,r.mode==='area'?'m²':'m',r.points])];
    const csv='\ufeff'+rows.map(r=>r.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(';')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`mediciones-ar-${new Date().toISOString().slice(0,10)}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  document.querySelectorAll('.mode').forEach(button=>button.addEventListener('click',()=>{
    mode=button.dataset.mode;document.querySelectorAll('.mode').forEach(b=>{const selected=b===button;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
  }));
  $('start').addEventListener('click',startAR);
  $('close-ar').addEventListener('click',()=>session?.end());
  $('mark').addEventListener('click',addPoint);
  $('undo').addEventListener('click',()=>{points.pop();updateControls();});
  $('save').addEventListener('click',saveMeasurement);
  $('export').addEventListener('click',exportCSV);
  overlay.addEventListener('beforexrselect',ev=>ev.preventDefault());
  renderRecords();
  (async()=>{
    const el=$('compat');
    if(!window.isSecureContext){el.textContent='La cámara AR requiere un sitio HTTPS (o localhost para desarrollo).';el.classList.add('bad');return;}
    if(!supported()){el.textContent='WebXR no disponible en este navegador. Prueba con Chrome Android y un celular compatible con ARCore.';el.classList.add('bad');return;}
    try{const ok=await navigator.xr.isSessionSupported('immersive-ar');el.textContent=ok?'✓ Sesión AR disponible. Comprueba la detección al iniciar la cámara.':'Este teléfono o navegador no admite sesiones AR inmersivas.';el.classList.add(ok?'good':'bad');}
    catch{el.textContent='No se pudo verificar la compatibilidad de realidad aumentada.';el.classList.add('bad');}
  })();
  if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
})();