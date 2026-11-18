'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const storageKey = 'medsolution_ar_body_measurements_v1';
  const pxDistance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const bodyCanvas = $('body-canvas');
  const ctx = bodyCanvas.getContext('2d');
  let image = null;
  let records = [];
  let calibration = null;
  let selections = [];
  let imagePoints = [];
  let autoLandmarks = null;
  let landmarker = null;
  let tool = 'calibrate';
  let currentMeasurement = null;
  let overlayHint = '';
  let busy = false;
  try { const saved=JSON.parse(localStorage.getItem(storageKey)||'[]'); records=Array.isArray(saved)?saved:[]; } catch {records=[];}
  const id = () => (globalThis.crypto?.randomUUID?.()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const safeTime = value => { try { return new Date(value).toLocaleString('es-BO',{timeZone:'America/La_Paz',dateStyle:'short',timeStyle:'short'}); } catch {return value;} };
  const recordTypes = {
    height:'Estatura', shoulders:'Ancho de hombros', hips:'Ancho de cadera',
    armL:'Brazo izquierdo', armR:'Brazo derecho', legL:'Pierna izquierda', legR:'Pierna derecha',
    arbitrary:'Distancia corporal', waist:'Perímetro cintura', chest:'Perímetro torácico',
    hipCirc:'Perímetro cadera', armCirc:'Perímetro brazo', thighCirc:'Perímetro muslo', other:'Otra medida'
  };
  const models = {
    shoulders:[11,12], hips:[23,24], armL:[11,13,15], armR:[12,14,16], legL:[23,25,27], legR:[24,26,28]
  };
  const pointName = k => recordTypes[k] || k;
  const present = n => `${Number(n).toFixed(1)} cm`;
  function tell(msg){ $('body-message').textContent=msg; }
  function setTool(name){tool=name;selections=[];imagePoints=[];currentMeasurement=null;syncTools();renderCanvas();}
  function syncTools(){
    document.querySelectorAll('[data-body-tool]').forEach(b=>{const on=b.dataset.bodyTool===tool;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});
    $('tool-help').textContent=tool==='calibrate'?'Marca dos extremos de una regla u objeto de longitud conocida, en el mismo plano que la persona.': 'Marca en la foto el inicio y el final del segmento que deseas medir.';
    $('body-result').textContent=currentMeasurement ? present(currentMeasurement.cm) : '—';
    $('save-body-photo').disabled=!currentMeasurement;
    $('scale-note').textContent=calibration?`Calibración: ${present(calibration.cm)} = ${calibration.pixels.toFixed(0)} píxeles. Debe estar en el mismo plano que el cuerpo.`:'Sin calibración. Debes marcar una regla de referencia para obtener centímetros.';
    $('body-undo').disabled=selections.length===0;
  }
  function pointFromPointer(evt){
    const rect=bodyCanvas.getBoundingClientRect();
    return {x:(evt.clientX-rect.left)/rect.width*bodyCanvas.width, y:(evt.clientY-rect.top)/rect.height*bodyCanvas.height};
  }
  function drawStroke(coords, color, width=4, close=false){
    if(coords.length===0)return;
    ctx.save();ctx.lineWidth=width;ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineJoin='round';ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(coords[0].x,coords[0].y);for(const p of coords.slice(1))ctx.lineTo(p.x,p.y);if(close)ctx.closePath();ctx.stroke();
    coords.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,Math.max(5,bodyCanvas.width/220),0,Math.PI*2);ctx.fill();ctx.strokeStyle='#061a30';ctx.lineWidth=2;ctx.stroke();});ctx.restore();
  }
  function renderCanvas(){
    ctx.clearRect(0,0,bodyCanvas.width,bodyCanvas.height);
    if(!image)return;
    ctx.drawImage(image,0,0,bodyCanvas.width,bodyCanvas.height);
    if(autoLandmarks){
      const w=bodyCanvas.width,h=bodyCanvas.height;
      const pairs=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
      ctx.save();ctx.lineWidth=3;ctx.strokeStyle='#55f1dc';ctx.fillStyle='#55f1dc';
      for(const [a,b] of pairs){if(autoLandmarks[a]?.visibility<.35||autoLandmarks[b]?.visibility<.35)continue;ctx.beginPath();ctx.moveTo(autoLandmarks[a].x*w,autoLandmarks[a].y*h);ctx.lineTo(autoLandmarks[b].x*w,autoLandmarks[b].y*h);ctx.stroke();}
      for(const i of [11,12,13,14,15,16,23,24,25,26,27,28]){const p=autoLandmarks[i];if(!p||p.visibility<.35)continue;ctx.beginPath();ctx.arc(p.x*w,p.y*h,Math.max(3,w/280),0,Math.PI*2);ctx.fill();}
      ctx.restore();
    }
    if(calibration)drawStroke(calibration.points,'#fad46d',Math.max(3,bodyCanvas.width/210));
    if(currentMeasurement?.points)drawStroke(currentMeasurement.points,'#4ce2c7',Math.max(4,bodyCanvas.width/180));
    if(selections.length)drawStroke(selections,'#fced86',Math.max(4,bodyCanvas.width/180));
  }
  function persist(){try{localStorage.setItem(storageKey,JSON.stringify(records));return true;}catch{tell('Almacenamiento lleno: no se pudo guardar.');return false;}}
  function addRecord(obj){const record={id:id(),date:new Date().toISOString(),code:$('body-code').value.trim().slice(0,60),...obj};records.unshift(record);if(persist()){renderRecords();return true;} records.shift();return false;}
  function renderRecords(){
    const root=$('body-records');root.replaceChildren();$('export-body').disabled=!records.length;
    if(!records.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Todavía no existen medidas corporales guardadas.';root.appendChild(empty);return;}
    for(const record of records){
      const card=document.createElement('div');card.className='record';
      const left=document.createElement('div');const h=document.createElement('strong');h.textContent=record.label||pointName(record.type);
      const detail=document.createElement('p');detail.textContent=`${safeTime(record.date)} · ${record.method==='camera'?'Foto calibrada':'Cinta / ingreso manual'}${record.code?' · Ref.: '+record.code:''}`;
      left.append(h,detail);
      const right=document.createElement('div');right.className='record-right';
      const value=document.createElement('span');value.className='record-val';value.textContent=present(record.cm);
      const del=document.createElement('button');del.className='trash';del.textContent='✕';del.title='Eliminar';del.setAttribute('aria-label','Eliminar medición corporal');
      del.addEventListener('click',()=>{if(confirm('¿Eliminar esta medida corporal?')){records=records.filter(r=>r.id!==record.id);persist();renderRecords();}});
      right.append(value,del);card.append(left,right);root.appendChild(card);
    }
  }
  function loadPhoto(file){
    if(!file)return;
    if(!file.type.startsWith('image/')){tell('Selecciona una imagen compatible.');return;}
    if(file.size>25*1024*1024){tell('Usa una fotografía de menos de 25 MB.');return;}
    const url=URL.createObjectURL(file);const img=new Image();
    img.onload=()=>{
      URL.revokeObjectURL(url);image=img;
      const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
      bodyCanvas.width=Math.max(1,Math.round(img.naturalWidth*scale));bodyCanvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      calibration=null;autoLandmarks=null;setTool('calibrate');
      $('photo-placeholder').hidden=true;bodyCanvas.hidden=false;
      $('auto-pose').disabled=false;
      tell('Foto cargada solo en el dispositivo. Primero calibra con una referencia de tamaño conocido.');
    };
    img.onerror=()=>{URL.revokeObjectURL(url);tell('No se pudo leer esta fotografía.');};img.src=url;
  }
  function computeUsingPoints(list,type='arbitrary'){
    if(!calibration)return null;
    if(!list || list.length<2)return null;
    const pixels=list.slice(1).reduce((sum,p,i)=>sum+pxDistance(list[i],p),0);
    const cm=pixels*calibration.cm/calibration.pixels;
    if(!Number.isFinite(cm)||cm<=0)return null;
    return {cm,points:list,type,label:pointName(type)};
  }
  function makeCalibrated(){
    const realCm=Number($('reference-cm').value);
    if(!Number.isFinite(realCm)||realCm<=0||realCm>1000){tell('Introduce una longitud de referencia válida en centímetros.');return;}
    if(selections.length!==2){tell('Marca dos extremos de la referencia en la foto.');return;}
    const pixels=pxDistance(selections[0],selections[1]);
    if(pixels<12){tell('Los puntos están demasiado próximos. Acerca la cámara a la referencia.');return;}
    calibration={cm:realCm,pixels,points:selections.map(p=>({...p}))};
    selections=[];tell('Escala calibrada. Selecciona «Medir segmento» y marca dos puntos anatómicos, o usa la postura detectada.');syncTools();renderCanvas();
  }
  bodyCanvas.addEventListener('pointerdown',event=>{
    if(!image)return;
    const p=pointFromPointer(event);selections.push(p);
    if(selections.length>=2){
      if(tool==='calibrate')makeCalibrated();
      else {
        currentMeasurement=computeUsingPoints(selections,$('photo-measure-type').value);
        if(!currentMeasurement)tell('Calibra primero una referencia para poder calcular centímetros.');
        else tell(`Segmento estimado: ${present(currentMeasurement.cm)}. Revisa los puntos y guarda si son correctos.`);
        selections=[];
      }
    }
    syncTools();renderCanvas();
  });
  async function analyzePose(){
    if(!image||busy)return;
    busy=true;$('auto-pose').disabled=true;$('auto-pose').textContent='Analizando postura…';
    try {
      if(!landmarker){
        // La librería y el modelo se descargan desde servidores oficiales/CDN;
        // la foto se procesa en este navegador, nunca se envía a un servicio de análisis.
        const {PoseLandmarker,FilesetResolver}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs');
        const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
        try{
          landmarker=await PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'GPU'},runningMode:'IMAGE',numPoses:1});
        }catch{
          landmarker=await PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'CPU'},runningMode:'IMAGE',numPoses:1});
        }
      }
      const clean=document.createElement('canvas');clean.width=bodyCanvas.width;clean.height=bodyCanvas.height;
      clean.getContext('2d').drawImage(image,0,0,clean.width,clean.height);
      const result=landmarker.detect(clean);
      if(!result.landmarks?.length){tell('No detecté una postura completa. Prueba una foto de cuerpo entero, con buena iluminación y fondo claro.');return;}
      autoLandmarks=result.landmarks[0];
      tell('Postura detectada. Los puntos son orientativos: verifica su posición y usa una regla de calibración antes de guardar medidas.');renderCanvas();
    }catch(err){tell('No se pudo descargar o ejecutar la IA. Puedes continuar marcando puntos manualmente; requiere conexión para cargar el modelo inicialmente.');console.warn('PoseLandmarker',err);}
    finally{busy=false;$('auto-pose').disabled=!image;$('auto-pose').textContent='Detectar postura con IA';}
  }
  function useAutoPoints(){
    if(!autoLandmarks){tell('Primero utiliza «Detectar postura con IA».');return;}
    const type=$('auto-measure-type').value,indices=models[type];
    if(!indices){tell('Selecciona un segmento compatible.');return;}
    if(indices.some(i=>!autoLandmarks[i]||autoLandmarks[i].visibility<.35)){tell('Una articulación no está suficientemente visible. Puedes marcarla manualmente.');return;}
    const list=indices.map(i=>({x:autoLandmarks[i].x*bodyCanvas.width,y:autoLandmarks[i].y*bodyCanvas.height}));
    currentMeasurement=computeUsingPoints(list,type);selections=[];
    if(!currentMeasurement)tell('Necesitas calibrar antes con una referencia de tamaño conocido.');
    else tell(`${pointName(type)} (estimado): ${present(currentMeasurement.cm)}. La postura y la perspectiva pueden alterar el resultado.`);
    syncTools();renderCanvas();
  }
  function savePhotoResult(){
    if(!currentMeasurement||!calibration){tell('Completa primero una medición calibrada.');return;}
    if(addRecord({type:currentMeasurement.type,label:currentMeasurement.label,cm:Number(currentMeasurement.cm.toFixed(2)),method:'camera'})){
      tell('Medición corporal guardada. La fotografía no se almacena.');currentMeasurement=null;selections=[];syncTools();renderCanvas();
    }
  }
  function saveManual(){
    const type=$('manual-type').value, cm=Number($('manual-cm').value);
    if(!Number.isFinite(cm)||cm<=0||cm>350){tell('Introduce una medida corporal válida mayor que 0 y menor o igual a 350 cm.');return;}
    if(addRecord({type,label:pointName(type),cm:Number(cm.toFixed(2)),method:'manual'})){$('manual-cm').value='';tell('Medida registrada.');}
  }
  function exportCSV(){
    if(!records.length)return;
    const rows=[['Tipo','Referencia local','Fecha ISO','Centímetros','Método'],...records.map(r=>[r.label||pointName(r.type),r.code||'',r.date,r.cm,r.method==='camera'?'Foto calibrada':'Manual'])];
    const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`medidas-corporales-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  document.querySelectorAll('[data-body-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.bodyTool)));
  $('photo-upload').addEventListener('change',e=>loadPhoto(e.target.files?.[0]));
  $('body-undo').addEventListener('click',()=>{selections.pop();currentMeasurement=null;syncTools();renderCanvas();});
  $('reset-scale').addEventListener('click',()=>{calibration=null;setTool('calibrate');tell('Calibración eliminada. Vuelve a marcar la regla.');});
  $('auto-pose').addEventListener('click',analyzePose);
  $('use-auto').addEventListener('click',useAutoPoints);
  $('save-body-photo').addEventListener('click',savePhotoResult);
  $('save-manual').addEventListener('click',saveManual);
  $('export-body').addEventListener('click',exportCSV);
  $('photo-measure-type').addEventListener('change',()=>{if(currentMeasurement){currentMeasurement.type=$('photo-measure-type').value;currentMeasurement.label=pointName(currentMeasurement.type);}syncTools();});
  document.querySelectorAll('[data-workspace]').forEach(b=>b.addEventListener('click',()=>{
    const active=b.dataset.workspace;
    document.querySelectorAll('[data-workspace]').forEach(tab=>{const selected=tab===b;tab.classList.toggle('active',selected);tab.setAttribute('aria-selected',String(selected));});
    document.querySelectorAll('[data-workspace-panel]').forEach(panel=>{panel.hidden=panel.dataset.workspacePanel!==active;});
  }));
  renderRecords();syncTools();
})();