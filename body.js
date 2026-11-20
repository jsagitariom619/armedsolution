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
  let segmenter = null;
  let silhouette = null;
  let personMaskIndex = -1;
  let autoRows = [];
  let automaticRows = [];
  let autoEdits = [];
  let dragging = null;
  let tool = 'calibrate';
  let currentMeasurement = null;
  let overlayHint = '';
  let busy = false;
  let frontalBounds = null;
  let lateralImage = null;
  let lateralDepths = null;
  let sideBusy = false;
  let imageGroupId = idForGroup();
  function idForGroup(){return (globalThis.crypto?.randomUUID?.())||'g-'+Date.now()+'-'+Math.random().toString(36).slice(2);}

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
    // Solo líneas de anchura detectadas; sin esqueleto de articulaciones.
    if(autoRows.length){
      ctx.save();
      for(const row of autoRows){
        if(!row.valid)continue;
        ctx.strokeStyle=row.color;ctx.fillStyle=row.color;ctx.lineWidth=Math.max(3,bodyCanvas.width/240);ctx.lineCap='round';
        ctx.beginPath();ctx.moveTo(row.left.x,row.left.y);ctx.lineTo(row.right.x,row.right.y);ctx.stroke();
        for(const p of [row.left,row.right]){ctx.beginPath();ctx.arc(p.x,p.y,Math.max(3,bodyCanvas.width/190),0,Math.PI*2);ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();ctx.strokeStyle=row.color;}
        ctx.font=`bold ${Math.max(12,bodyCanvas.width/48)}px system-ui`;ctx.fillText(row.label,Math.min(row.left.x,row.right.x)+4,Math.max(18,row.left.y-8));
      }
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
      const methodLabel=record.method==='simulated-front'?'Simulación con foto frontal':record.method==='simulated-two-view'?'Simulación con dos fotos':record.method==='ai-calibrated'?'IA automática calibrada':record.method==='camera'?'Foto calibrada':'Cinta / ingreso manual';
      const detail=document.createElement('p');detail.textContent=`${safeTime(record.date)} · ${methodLabel}${record.code?' · Ref.: '+record.code:''}`;
      left.append(h,detail);
      const right=document.createElement('div');right.className='record-right';
      const value=document.createElement('span');value.className='record-val';value.textContent=Number.isFinite(record.minCm)&&Number.isFinite(record.maxCm)
        ? `${record.minCm.toFixed(1)}–${record.maxCm.toFixed(1)} cm`
        : present(record.cm);
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
      calibration=null;autoLandmarks=null;silhouette=null;autoRows=[];automaticRows=[];autoEdits=[];
      frontalBounds=null;lateralImage=null;lateralDepths=null;imageGroupId=idForGroup();
      $('circumference-section').hidden=true;$('side-photo-status').textContent='La foto lateral no se guarda.';
      $('side-photo-preview').hidden=true;$('side-remove').hidden=true;
      setTool('calibrate');
      $('photo-stage').hidden=false;$('results-section').hidden=true;$('silhouette-preview').hidden=true;
      $('photo-placeholder').hidden=true;bodyCanvas.hidden=false;
      $('auto-pose').disabled=false;$('auto-measure').disabled=false;
      $('auto-summary').hidden=true;$('auto-actions').hidden=true;
      tell('Foto cargada localmente.');
      $('auto-status').textContent='Foto lista. Introduce la estatura para medir.';
      if(validHeight())void detectAutomatic({useHeight:true});
    };
    img.onerror=()=>{URL.revokeObjectURL(url);tell('No se pudo leer esta fotografía.');};img.src=url;
  }
  const regionDefinitions=[
    {key:'shoulders',label:'Hombros',color:'#ff5b73',ratio:0},
    {key:'bustWidth',label:'Busto / tórax',color:'#ffb547',ratio:.30},
    {key:'waistWidth',label:'Cintura',color:'#45d7c5',ratio:.68},
    {key:'hipWidth',label:'Cadera',color:'#8b79ff',ratio:1}
  ];
  // Mantener paquete y WASM en una misma versión estable.
  // Si el CDN primario falla en Android, probar un segundo proveedor.
  const visionBases=[
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21',
    'https://unpkg.com/@mediapipe/tasks-vision@0.10.21'
  ];
  let visionRuntime=null;
  async function loadVisionRuntime(){
    if(visionRuntime)return visionRuntime;
    for(const base of visionBases){
      try{
        const module=await import(base+'/vision_bundle.mjs');
        const {PoseLandmarker,ImageSegmenter,FilesetResolver}=module;
        if(!PoseLandmarker||!ImageSegmenter||!FilesetResolver)throw new Error('El módulo no contiene las clases esperadas.');
        const fileset=await FilesetResolver.forVisionTasks(base+'/wasm');
        visionRuntime={PoseLandmarker,ImageSegmenter,fileset};
        return visionRuntime;
      }catch(error){
        console.warn('MediaPipe no disponible desde '+base,error);
      }
    }
    throw new Error('No se pudo descargar la IA desde ninguno de los proveedores. Comprueba tu conexión y vuelve a intentar.');
  }
  async function ensureDetectors(){
    if(!landmarker||!segmenter){
      const {PoseLandmarker,ImageSegmenter,fileset:vision}=await loadVisionRuntime();
      if(!landmarker){
        try{landmarker=await PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'GPU'},runningMode:'IMAGE',numPoses:1});}
        catch{landmarker=await PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'CPU'},runningMode:'IMAGE',numPoses:1});}
      }
      if(!segmenter){
        const opts={baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',delegate:'GPU'},runningMode:'IMAGE',outputCategoryMask:true,outputConfidenceMasks:true};
        try{segmenter=await ImageSegmenter.createFromOptions(vision,opts);}
        catch{segmenter=await ImageSegmenter.createFromOptions(vision,{...opts,baseOptions:{...opts.baseOptions,delegate:'CPU'}});}
        const labels=segmenter.getLabels?.()||[];
        personMaskIndex=labels.findIndex(label=>/person|human|foreground/i.test(label));
      }
    }
  }
  function readMask(result){
    const masks=result.confidenceMasks||[];
    const mask=masks.length?masks[personMaskIndex>=0?personMaskIndex:masks.length-1]:result.categoryMask;
    if(!mask)return null;
    let data;
    if(result.confidenceMasks?.length){data=mask.getAsFloat32Array();return {data,width:mask.width,height:mask.height,threshold:.35,confidence:true};}
    data=mask.getAsUint8Array();return {data,width:mask.width,height:mask.height,threshold:0,confidence:false};
  }
  function maskAt(x,y){
    if(!silhouette)return false;
    const ix=Math.max(0,Math.min(silhouette.width-1,Math.floor(x/bodyCanvas.width*silhouette.width)));
    const iy=Math.max(0,Math.min(silhouette.height-1,Math.floor(y/bodyCanvas.height*silhouette.height)));
    const v=silhouette.data[iy*silhouette.width+ix];
    return silhouette.confidence?v>=silhouette.threshold:v>0;
  }
  function findSilhouetteEdges(y){
    const hits=[];const step=Math.max(1,Math.round(bodyCanvas.width/800));
    for(let x=0;x<bodyCanvas.width;x+=step)if(maskAt(x,y))hits.push(x);
    if(hits.length<Math.max(8,bodyCanvas.width*.015))return null;
    // Keep the widest contiguous run, avoiding isolated mask noise.
    let best=[hits[0],hits[0]],start=hits[0],prev=hits[0];
    for(const x of hits.slice(1)){if(x-prev>step*3){if(prev-start>best[1]-best[0])best=[start,prev];start=x;}prev=x;}
    if(prev-start>best[1]-best[0])best=[start,prev];
    if(best[1]-best[0]<bodyCanvas.width*.025)return null;
    return {left:best[0],right:best[1]};
  }

  function validHeight(){
    const field=$('known-height');
    const cm=Number(field.value);
    return field.value.trim()!==''&&Number.isFinite(cm)&&cm>=80&&cm<=250;
  }
  function renderSilhouettePreview(){
    if(!silhouette)return;
    const sw=silhouette.width,sh=silhouette.height;
    if(!sw||!sh||sw*sh>4000000)return;
    const bitmap=document.createElement('canvas');bitmap.width=sw;bitmap.height=sh;
    const bc=bitmap.getContext('2d');
    const pixels=bc.createImageData(sw,sh);
    for(let i=0;i<sw*sh;i++){
      const show=silhouette.confidence?silhouette.data[i]>=silhouette.threshold:silhouette.data[i]>0;
      if(show){const k=4*i;pixels.data[k]=29;pixels.data[k+1]=148;pixels.data[k+2]=140;pixels.data[k+3]=230;}
    }
    bc.putImageData(pixels,0,0);
    const preview=$('silhouette-canvas');preview.width=bodyCanvas.width;preview.height=bodyCanvas.height;
    const pc=preview.getContext('2d');pc.clearRect(0,0,preview.width,preview.height);
    pc.drawImage(bitmap,0,0,preview.width,preview.height);
    for(const row of autoRows){
      if(!row.valid)continue;
      pc.beginPath();pc.lineWidth=Math.max(3,preview.width/250);pc.strokeStyle=row.color;
      pc.moveTo(row.left.x,row.y);pc.lineTo(row.right.x,row.y);pc.stroke();
    }
    $('silhouette-preview').hidden=false;
  }
  async function detectAutomatic({useHeight=true}={}){
    if(!image||busy)return;
    if(!validHeight()){
      $('auto-status').textContent='Escribe una estatura válida (80–250 cm) para poder medir.';
      $('known-height').focus();return;
    }
    lateralDepths=null;
    frontalBounds=null;
    busy=true;$('auto-measure').disabled=true;$('auto-measure').textContent='Analizando foto…';$('auto-status').textContent='Reconociendo la silueta en tu teléfono…';
    try{
      await ensureDetectors();
      const clean=document.createElement('canvas');clean.width=bodyCanvas.width;clean.height=bodyCanvas.height;clean.getContext('2d').drawImage(image,0,0,clean.width,clean.height);
      const pose=landmarker.detect(clean);const seg=segmenter.segment(clean);
      if(!pose.landmarks?.length){throw new Error('No se detectó una postura completa.');}
      autoLandmarks=pose.landmarks[0];silhouette=readMask(seg);
      if(!silhouette)throw new Error('El modelo no devolvió una máscara de silueta.');
      const required=[11,12,23,24];
      if(required.some(i=>!autoLandmarks[i]||(autoLandmarks[i].visibility??0)<.5))throw new Error('No se ven con claridad los hombros y la cadera. Prueba una postura frontal con brazos separados.');
      if(useHeight){
        const height=Number($('known-height').value);
        if(!Number.isFinite(height)||height<80||height>250)throw new Error('Escribe tu estatura conocida entre 80 y 250 cm.');
        const ankleY=Math.max(autoLandmarks[27]?.y||0,autoLandmarks[28]?.y||0)*bodyCanvas.height;
        let top=bodyCanvas.height,bottom=0;
        for(let y=0;y<bodyCanvas.height;y+=Math.max(1,Math.round(bodyCanvas.height/500)))if(findSilhouetteEdges(y)){top=Math.min(top,y);bottom=Math.max(bottom,y);}
        if(bottom-top<bodyCanvas.height*.35)throw new Error('La foto no muestra el cuerpo completo. No puedo calibrar con estatura.');
        // Landmark ankle extent is used to reject a mask that misses the feet; full mask bounds determine scale.
        if(ankleY<top||ankleY>bottom+bodyCanvas.height*.06)throw new Error('La silueta no incluye bien los pies; usa una foto de cuerpo completo.');
        calibration={cm:height,pixels:bottom-top,points:[],source:'known-height'};
        frontalBounds={top,bottom};
      }
      if(!calibration)throw new Error('Primero calibra con una referencia conocida en el plano del cuerpo, o introduce tu estatura real y pulsa «Calibrar con estatura».');
      const shoulderY=(autoLandmarks[11].y+autoLandmarks[12].y)*.5*bodyCanvas.height;
      const hipY=(autoLandmarks[23].y+autoLandmarks[24].y)*.5*bodyCanvas.height;
      if(hipY<=shoulderY)throw new Error('La postura detectada no permite ubicar las regiones del torso.');
      autoRows=[];
      for(const def of regionDefinitions){
        const y=shoulderY+(hipY-shoulderY)*def.ratio;const edges=findSilhouetteEdges(y);
        if(!edges){autoRows.push({...def,valid:false,y,left:{x:0,y},right:{x:0,y},confidence:'Baja'});continue;}
        autoRows.push({...def,valid:true,y,left:{x:edges.left,y},right:{x:edges.right,y},confidence:'Estimación visual'});
      }
      const valid=autoRows.filter(r=>r.valid).length;
      if(valid<2)throw new Error('La segmentación no encontró bordes suficientes en el torso. Usa una foto con ropa contrastada y brazos separados.');
      autoEdits=[];
      automaticRows=snapshotRows();
      $('results-section').hidden=false;$('auto-summary').hidden=false;$('auto-actions').hidden=false;
      $('auto-status').textContent=`Listo. Se estimaron ${valid} de 4 anchuras. Son valores aproximados de una foto frontal.`;
      renderAutoSummary();renderCanvas();renderSilhouettePreview();renderCircumferences();
    }catch(err){
      $('results-section').hidden=true;
      $('auto-status').textContent=err.message||'No se pudo medir esta fotografía. Prueba otra con el cuerpo completo.';
      console.warn('Body automatic measurement',err);
    }finally{
      busy=false;$('auto-measure').disabled=!image;$('auto-measure').textContent='Medir automáticamente';
      if(lateralImage && !document.getElementById('results-section').hidden)void analyzeLateralPhoto();
    }
  }
  function rowValue(row){return row.valid&&calibration?pxDistance(row.left,row.right)*calibration.cm/calibration.pixels:null;}
  function renderAutoSummary(){
    const root=$('auto-summary');root.replaceChildren();
    for(const row of autoRows){const item=document.createElement('div');item.className='auto-result';const name=document.createElement('span');name.textContent=row.label;const value=document.createElement('strong');value.textContent=row.valid&&rowValue(row)?`${rowValue(row).toFixed(1)} cm`:'No detectado';item.style.setProperty('--region',row.color);item.append(name,value);root.append(item);}
    $('undo-auto-edit').disabled=!autoEdits.length;
  }

  // Simulación explícita: en frontal se asume profundidad del 50% al 90% del ancho.
  // Con foto lateral se usa profundidad segmentada y un modelo de sección elíptica.
  const circumDefinitions=[
    {key:'bustWidth',label:'Busto',type:'circumBust'},
    {key:'waistWidth',label:'Cintura',type:'circumWaist'},
    {key:'hipWidth',label:'Cadera',type:'circumHip'}
  ];
  function circumferenceEstimates(){
    const math=window.MedSolutionCircumference;
    if(!math)return [];
    return circumDefinitions.map(def=>{
      const row=autoRows.find(x=>x.key===def.key),width=row?rowValue(row):null;
      if(!width||!Number.isFinite(width))return {...def,estimate:null};
      const depth=lateralDepths?.[def.key];
      const estimate=depth?math.twoView(width,depth):math.frontalRange(width);
      return {...def,estimate};
    });
  }
  function renderCircumferences(){
    const root=$('circumference-summary');root.replaceChildren();
    const estimates=circumferenceEstimates();
    if(!autoRows.length||!estimates.length){$('circumference-section').hidden=true;return;}
    $('circumference-section').hidden=false;
    for(const entry of estimates){
      const card=document.createElement('div');card.className='circumference-item';
      const line=document.createElement('div'),name=document.createElement('b'),value=document.createElement('strong');
      name.textContent=entry.label;
      const m=entry.estimate;
      value.textContent=!m?'No estimable':m.kind==='two-view'? '≈ '+m.cm.toFixed(1)+' cm' :m.minCm.toFixed(1)+'–'+m.maxCm.toFixed(1)+' cm';
      const detail=document.createElement('small');
      detail.textContent=!m?'No se detectó un ancho fiable en esta región.':
        m.kind==='two-view'?'Simulación elíptica: ancho frontal + profundidad lateral. No es una medición clínica.':
        'Rango hipotético de una foto: profundidad supuesta del 50% al 90% del ancho. No equivale a un intervalo estadístico de confianza.';
      line.append(name,value);card.append(line,detail);root.append(card);
    }
  }
  function sideMaskAt(mask,width,height,x,y){
    const px=Math.max(0,Math.min(mask.width-1,Math.floor(x/width*mask.width)));
    const py=Math.max(0,Math.min(mask.height-1,Math.floor(y/height*mask.height)));
    const value=mask.data[py*mask.width+px];
    return mask.confidence?value>=mask.threshold:value>0;
  }
  function sideEdges(mask,w,h,y,centerX=null){
    const step=Math.max(1,Math.round(w/700)),runs=[];
    let first=null,previous=null;
    for(let x=0;x<w;x+=step){
      if(sideMaskAt(mask,w,h,x,y)){
        if(first===null)first=x;previous=x;
      }else if(first!==null){runs.push({left:first,right:previous});first=null;}
    }
    if(first!==null)runs.push({left:first,right:previous});
    const good=runs.filter(r=>r.right-r.left>=w*.02);
    if(!good.length)return null;
    if(Number.isFinite(centerX)){
      const near=good.filter(r=>centerX>=r.left-w*.08&&centerX<=r.right+w*.08);
      if(near.length)return near.sort((a,b)=>(b.right-b.left)-(a.right-a.left))[0];
    }
    return good.sort((a,b)=>(b.right-b.left)-(a.right-a.left))[0];
  }
  function sideBoundsFor(mask,w,h){
    let top=h,bottom=0;
    const step=Math.max(1,Math.floor(h/450));
    for(let y=0;y<h;y+=step){
      const e=sideEdges(mask,w,h,y);
      if(e && e.right-e.left>=w*.025){top=Math.min(top,y);bottom=Math.max(bottom,y);}
    }
    return top<bottom?{top,bottom}:null;
  }
  async function loadLateralPhoto(file){
    if(!file)return;
    if(!file.type.startsWith('image/')||file.size>25*1024*1024){
      $('side-photo-status').textContent='Selecciona una fotografía compatible, de menos de 25 MB.';return;
    }
    const url=URL.createObjectURL(file),img=new Image();
    img.onload=()=>{
      URL.revokeObjectURL(url);
      lateralImage=img;lateralDepths=null;
      const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
      const preview=$('side-photo-preview');
      preview.width=Math.max(1,Math.round(img.naturalWidth*scale));
      preview.height=Math.max(1,Math.round(img.naturalHeight*scale));
      preview.getContext('2d').drawImage(img,0,0,preview.width,preview.height);
      preview.hidden=false;$('side-remove').hidden=false;
      $('side-photo-status').textContent='Foto lateral lista. Calculando profundidad…';
      renderCircumferences();void analyzeLateralPhoto();
    };
    img.onerror=()=>{URL.revokeObjectURL(url);$('side-photo-status').textContent='No se pudo leer la foto lateral.';};
    img.src=url;
  }
  async function analyzeLateralPhoto(){
    if(!lateralImage||!frontalBounds||!autoRows.length||sideBusy||busy)return;
    sideBusy=true;
    const sidePhoto=lateralImage;
    const status=$('side-photo-status');
    status.textContent='Analizando la silueta lateral en el teléfono…';
    try{
      await ensureDetectors();
      if(lateralImage!==sidePhoto)return;
      const canvas=$('side-photo-preview');
      const pose=landmarker.detect(canvas),result=segmenter.segment(canvas);
      if(!pose.landmarks?.length)throw new Error('No se identificó una persona en la foto lateral.');
      const mask=readMask(result);
      if(!mask)throw new Error('No se identificó la silueta lateral.');
      const bounds=sideBoundsFor(mask,canvas.width,canvas.height);
      if(!bounds||bounds.bottom-bounds.top<canvas.height*.45)throw new Error('Necesitamos una foto lateral de cuerpo entero, desde cabeza hasta pies.');
      const landmarks=pose.landmarks[0];
      const torso=[11,12,23,24].filter(i=>landmarks[i]&&landmarks[i].visibility>.3);
      if(torso.length<2)throw new Error('Los hombros y la cadera no se distinguen en la foto lateral.');
      const centerX=torso.reduce((sum,i)=>sum+landmarks[i].x,0)/torso.length*canvas.width;
      const ratio=Number($('known-height').value)/(bounds.bottom-bounds.top);
      const depths={};
      for(const def of circumDefinitions){
        const row=autoRows.find(x=>x.key===def.key);
        if(!row?.valid)continue;
        const fractional=(row.y-frontalBounds.top)/(frontalBounds.bottom-frontalBounds.top);
        if(fractional<.08||fractional>.86)continue;
        const y=bounds.top+fractional*(bounds.bottom-bounds.top);
        const edges=sideEdges(mask,canvas.width,canvas.height,y,centerX);
        if(!edges)continue;
        const depth=(edges.right-edges.left)*ratio;
        const width=rowValue(row);
        if(Number.isFinite(depth)&&depth>0&&width&&depth>=width*.25&&depth<=width*1.4)depths[def.key]=depth;
      }
      if(lateralImage!==sidePhoto)return;
      if(!Object.keys(depths).length)throw new Error('No se identificó una profundidad útil. Prueba una foto totalmente de perfil y sin brazos delante del torso.');
      lateralDepths=depths;
      status.textContent='Se usó la profundidad lateral en '+Object.keys(depths).length+' de 3 regiones. Las restantes siguen como rangos simulados.';
      renderCircumferences();$('auto-actions').hidden=false;
    }catch(error){
      if(lateralImage!==sidePhoto)return;
      lateralDepths=null;renderCircumferences();
      status.textContent=error.message||'No se pudo medir la profundidad lateral; se mantienen los rangos de la foto frontal.';
      console.warn('Lateral estimation',error);
    }finally{sideBusy=false;}
  }
  function removeLateralPhoto(){
    lateralImage=null;lateralDepths=null;
    $('side-photo-preview').hidden=true;$('side-remove').hidden=true;
    $('side-photo-status').textContent='Foto lateral eliminada. Se muestran rangos simulados a partir de la fotografía frontal.';
    renderCircumferences();
  }
  function snapshotRows(){return autoRows.map(r=>({...r,left:{...r.left},right:{...r.right}}));}
  function restoreAuto(){if(!automaticRows.length){$('auto-status').textContent='Primero detecta la silueta.';return;}autoRows=automaticRows.map(r=>({...r,left:{...r.left},right:{...r.right}}));autoEdits=[];renderAutoSummary();renderCanvas();renderCircumferences();$('auto-status').textContent='Puntos automáticos restablecidos.';}
  function confirmAuto(){
    const valid=autoRows.filter(r=>r.valid&&rowValue(r));
    if(!valid.length){$('auto-status').textContent='No hay anchuras calibradas para guardar.';return;}
    const now=new Date().toISOString(),code=$('body-code').value.trim().slice(0,60);
    const entries=valid.map(row=>({id:id(),groupId:imageGroupId,date:now,code,type:row.key,label:`Ancho de ${row.label.toLowerCase()}`,cm:Number(rowValue(row).toFixed(1)),method:'ai-calibrated'}));
    for(const item of circumferenceEstimates()){
      const m=item.estimate;
      if(!m)continue;
      const entry={id:id(),groupId:imageGroupId,date:now,code,type:item.type,label:'Circunferencia simulada de '+item.label.toLowerCase(),method:m.kind==='two-view'?'simulated-two-view':'simulated-front',cm:Number((m.kind==='front'?m.midCm:m.cm).toFixed(1)),frontWidthCm:Number(m.widthCm.toFixed(1)),model:'ellipse-ramanujan'};
      if(m.kind==='front'){entry.minCm=Number(m.minCm.toFixed(1));entry.maxCm=Number(m.maxCm.toFixed(1));entry.depthRatioAssumption=[.5,.9];}
      else entry.depthCm=Number(m.depthCm.toFixed(1));
      entries.push(entry);
    }
    const old=records;
    records=[...entries,...records.filter(r=>r.groupId!==imageGroupId)];
    if(persist()){
      renderRecords();$('auto-status').textContent='Se guardaron '+entries.length+' resultados. Las circunferencias están identificadas como simuladas.';$('auto-actions').hidden=true;
    }else records=old;
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
    const p=pointFromPointer(event);
    if(autoRows.length){
      let nearest=null,dist=Infinity;
      autoRows.forEach((row,ri)=>{if(!row.valid)return;for(const side of ['left','right']){const d=pxDistance(p,row[side]);if(d<dist){dist=d;nearest={ri,side};}}});
      if(nearest&&dist<Math.max(28,bodyCanvas.width*.045)){autoEdits.push(snapshotRows());dragging=nearest;bodyCanvas.setPointerCapture(event.pointerId);event.preventDefault();}
      return;
    }
    selections.push(p);
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
  bodyCanvas.addEventListener('pointermove',event=>{
    if(!dragging)return;const p=pointFromPointer(event);const row=autoRows[dragging.ri];
    row[dragging.side]={x:Math.max(0,Math.min(bodyCanvas.width,p.x)),y:row.y};
    renderAutoSummary();renderCanvas();renderCircumferences();
  });
  bodyCanvas.addEventListener('pointerup',()=>{dragging=null;});
  bodyCanvas.addEventListener('pointercancel',()=>{dragging=null;});
  async function analyzePose(){
    if(!image||busy)return;
    busy=true;$('auto-pose').disabled=true;$('auto-pose').textContent='Analizando postura…';
    try {
      if(!landmarker){
        // La librería y el modelo se descargan desde servidores oficiales/CDN;
        // la foto se procesa en este navegador, nunca se envía a un servicio de análisis.
        const {PoseLandmarker,fileset:vision}=await loadVisionRuntime();
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
    const rows=[['Tipo','Referencia local','Fecha ISO','Centímetros (centro de rango si es simulación frontal)','Método','Rango mínimo simulado (cm)','Rango máximo simulado (cm)','Profundidad lateral estimada (cm)','Modelo'],...records.map(r=>[r.label||pointName(r.type),r.code||'',r.date,r.cm,r.method==='simulated-front'?'Simulación frontal no validada':r.method==='simulated-two-view'?'Simulación dos vistas no validada':r.method==='ai-calibrated'?'IA automática con calibración':r.method==='camera'?'Foto calibrada':'Manual',r.minCm??'',r.maxCm??'',r.depthCm??'',r.model??''])];
    const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`medidas-corporales-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  document.querySelectorAll('[data-body-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.bodyTool)));
  // Android puede abrir la cámara directamente cuando existe capture.
  // Mantenemos dos entradas independientes y una sola ruta de procesamiento.
  ['photo-camera','photo-upload'].forEach(id=>{
    $(id).addEventListener('change',event=>{
      const file=event.target.files?.[0];
      if(file)loadPhoto(file);
      // Permite volver a seleccionar la misma imagen después.
      event.target.value='';
    });
  });
  ['side-camera','side-upload'].forEach(inputId=>{
    $(inputId).addEventListener('change',event=>{
      const file=event.target.files?.[0];
      if(file)void loadLateralPhoto(file);
      event.target.value='';
    });
  });
  $('side-remove').addEventListener('click',removeLateralPhoto);
  $('auto-measure').addEventListener('click',()=>detectAutomatic({useHeight:true}));
  $('known-height').addEventListener('change',()=>{if(image&&validHeight()&&!busy)void detectAutomatic({useHeight:true});});
  $('calibrate-height').addEventListener('click',()=>detectAutomatic({useHeight:true}));
  $('undo-auto-edit').addEventListener('click',()=>{const previous=autoEdits.pop();if(previous)autoRows=previous;renderAutoSummary();renderCanvas();});
  $('reset-auto').addEventListener('click',restoreAuto);
  $('confirm-auto').addEventListener('click',confirmAuto);
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
