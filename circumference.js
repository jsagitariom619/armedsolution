'use strict';
// Estimación geométrica experimental, NO fórmula antropométrica validada.
// El rango frontal proviene de profundidades hipotéticas de 0,5 a 0,9 veces el ancho.
// Las dos vistas usan profundidad visible y aproximación elíptica de Ramanujan.
(function(root){
  function ellipsePerimeter(widthCm,depthCm){
    if(!Number.isFinite(widthCm)||!Number.isFinite(depthCm)||widthCm<=0||depthCm<=0)return null;
    const a=widthCm/2,b=depthCm/2;
    const h=((a-b)/(a+b))**2;
    return Math.PI*(a+b)*(1+(3*h)/(10+Math.sqrt(4-3*h)));
  }
  function frontalRange(widthCm){
    if(!Number.isFinite(widthCm)||widthCm<=0||widthCm>250)return null;
    const lo=ellipsePerimeter(widthCm,widthCm*.5);
    const hi=ellipsePerimeter(widthCm,widthCm*.9);
    return {kind:'front',minCm:lo,maxCm:hi,midCm:(lo+hi)/2,widthCm,depthRatio:[.5,.9]};
  }
  function twoView(widthCm,depthCm){
    if(!Number.isFinite(widthCm)||!Number.isFinite(depthCm)||widthCm<=0||depthCm<=0||widthCm>250||depthCm>250)return null;
    return {kind:'two-view',cm:ellipsePerimeter(widthCm,depthCm),widthCm,depthCm};
  }
  const api=Object.freeze({ellipsePerimeter,frontalRange,twoView});
  root.MedSolutionCircumference=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
