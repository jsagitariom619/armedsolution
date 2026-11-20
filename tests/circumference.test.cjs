'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {ellipsePerimeter,frontalRange,twoView}=require('../circumference.js');
test('círculo: ancho y profundidad iguales',()=>{
 assert.ok(Math.abs(ellipsePerimeter(30,30)-Math.PI*30)<1e-9);
});
test('el perímetro aumenta con la profundidad',()=>{
 assert.ok(ellipsePerimeter(30,15)<ellipsePerimeter(30,25));
});
test('solo frontal: devolver intervalo, no valor pretendidamente medido',()=>{
 const r=frontalRange(30);assert.equal(r.kind,'front');assert.ok(r.minCm<r.maxCm);
 assert.equal(r.depthRatio[0],.5);assert.equal(r.depthRatio[1],.9);
});
test('dos vistas: usar profundidad proporcionada',()=>{
 assert.ok(Math.abs(twoView(30,20).cm-ellipsePerimeter(30,20))<1e-9);
});
test('datos sin escala: rechazar valores',()=>{
 assert.equal(frontalRange(0),null);assert.equal(twoView(30,NaN),null);
});
