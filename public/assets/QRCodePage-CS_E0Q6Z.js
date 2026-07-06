import{j as N}from"./admin-CGhwvvhm.js";import{r as dt}from"./vendor-DAvk9mcP.js";var K={},Rt=function(){return typeof Promise=="function"&&Promise.prototype&&Promise.prototype.then},wt={},I={};let at;const Lt=[0,26,44,70,100,134,172,196,242,292,346,404,466,532,581,655,733,815,901,991,1085,1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,2323,2465,2611,2761,2876,3034,3196,3362,3532,3706];I.getSymbolSize=function(t){if(!t)throw new Error('"version" cannot be null or undefined');if(t<1||t>40)throw new Error('"version" should be in range from 1 to 40');return t*4+17};I.getSymbolTotalCodewords=function(t){return Lt[t]};I.getBCHDigit=function(e){let t=0;for(;e!==0;)t++,e>>>=1;return t};I.setToSJISFunction=function(t){if(typeof t!="function")throw new Error('"toSJISFunc" is not a valid function.');at=t};I.isKanjiModeEnabled=function(){return typeof at<"u"};I.toSJIS=function(t){return at(t)};var $={};(function(e){e.L={bit:1},e.M={bit:0},e.Q={bit:3},e.H={bit:2};function t(i){if(typeof i!="string")throw new Error("Param is not a string");switch(i.toLowerCase()){case"l":case"low":return e.L;case"m":case"medium":return e.M;case"q":case"quartile":return e.Q;case"h":case"high":return e.H;default:throw new Error("Unknown EC Level: "+i)}}e.isValid=function(o){return o&&typeof o.bit<"u"&&o.bit>=0&&o.bit<4},e.from=function(o,n){if(e.isValid(o))return o;try{return t(o)}catch{return n}}})($);function pt(){this.buffer=[],this.length=0}pt.prototype={get:function(e){const t=Math.floor(e/8);return(this.buffer[t]>>>7-e%8&1)===1},put:function(e,t){for(let i=0;i<t;i++)this.putBit((e>>>t-i-1&1)===1)},getLengthInBits:function(){return this.length},putBit:function(e){const t=Math.floor(this.length/8);this.buffer.length<=t&&this.buffer.push(0),e&&(this.buffer[t]|=128>>>this.length%8),this.length++}};var kt=pt;function O(e){if(!e||e<1)throw new Error("BitMatrix size must be defined and greater than 0");this.size=e,this.data=new Uint8Array(e*e),this.reservedBit=new Uint8Array(e*e)}O.prototype.set=function(e,t,i,o){const n=e*this.size+t;this.data[n]=i,o&&(this.reservedBit[n]=!0)};O.prototype.get=function(e,t){return this.data[e*this.size+t]};O.prototype.xor=function(e,t,i){this.data[e*this.size+t]^=i};O.prototype.isReserved=function(e,t){return this.reservedBit[e*this.size+t]};var Dt=O,yt={};(function(e){const t=I.getSymbolSize;e.getRowColCoords=function(o){if(o===1)return[];const n=Math.floor(o/7)+2,r=t(o),s=r===145?26:Math.ceil((r-13)/(2*n-2))*2,l=[r-7];for(let a=1;a<n-1;a++)l[a]=l[a-1]-s;return l.push(6),l.reverse()},e.getPositions=function(o){const n=[],r=e.getRowColCoords(o),s=r.length;for(let l=0;l<s;l++)for(let a=0;a<s;a++)l===0&&a===0||l===0&&a===s-1||l===s-1&&a===0||n.push([r[l],r[a]]);return n}})(yt);var Et={};const _t=I.getSymbolSize,gt=7;Et.getPositions=function(t){const i=_t(t);return[[0,0],[i-gt,0],[0,i-gt]]};var Ct={};(function(e){e.Patterns={PATTERN000:0,PATTERN001:1,PATTERN010:2,PATTERN011:3,PATTERN100:4,PATTERN101:5,PATTERN110:6,PATTERN111:7};const t={N1:3,N2:3,N3:40,N4:10};e.isValid=function(n){return n!=null&&n!==""&&!isNaN(n)&&n>=0&&n<=7},e.from=function(n){return e.isValid(n)?parseInt(n,10):void 0},e.getPenaltyN1=function(n){const r=n.size;let s=0,l=0,a=0,c=null,u=null;for(let C=0;C<r;C++){l=a=0,c=u=null;for(let m=0;m<r;m++){let f=n.get(C,m);f===c?l++:(l>=5&&(s+=t.N1+(l-5)),c=f,l=1),f=n.get(m,C),f===u?a++:(a>=5&&(s+=t.N1+(a-5)),u=f,a=1)}l>=5&&(s+=t.N1+(l-5)),a>=5&&(s+=t.N1+(a-5))}return s},e.getPenaltyN2=function(n){const r=n.size;let s=0;for(let l=0;l<r-1;l++)for(let a=0;a<r-1;a++){const c=n.get(l,a)+n.get(l,a+1)+n.get(l+1,a)+n.get(l+1,a+1);(c===4||c===0)&&s++}return s*t.N2},e.getPenaltyN3=function(n){const r=n.size;let s=0,l=0,a=0;for(let c=0;c<r;c++){l=a=0;for(let u=0;u<r;u++)l=l<<1&2047|n.get(c,u),u>=10&&(l===1488||l===93)&&s++,a=a<<1&2047|n.get(u,c),u>=10&&(a===1488||a===93)&&s++}return s*t.N3},e.getPenaltyN4=function(n){let r=0;const s=n.data.length;for(let a=0;a<s;a++)r+=n.data[a];return Math.abs(Math.ceil(r*100/s/5)-10)*t.N4};function i(o,n,r){switch(o){case e.Patterns.PATTERN000:return(n+r)%2===0;case e.Patterns.PATTERN001:return n%2===0;case e.Patterns.PATTERN010:return r%3===0;case e.Patterns.PATTERN011:return(n+r)%3===0;case e.Patterns.PATTERN100:return(Math.floor(n/2)+Math.floor(r/3))%2===0;case e.Patterns.PATTERN101:return n*r%2+n*r%3===0;case e.Patterns.PATTERN110:return(n*r%2+n*r%3)%2===0;case e.Patterns.PATTERN111:return(n*r%3+(n+r)%2)%2===0;default:throw new Error("bad maskPattern:"+o)}}e.applyMask=function(n,r){const s=r.size;for(let l=0;l<s;l++)for(let a=0;a<s;a++)r.isReserved(a,l)||r.xor(a,l,i(n,a,l))},e.getBestMask=function(n,r){const s=Object.keys(e.Patterns).length;let l=0,a=1/0;for(let c=0;c<s;c++){r(c),e.applyMask(c,n);const u=e.getPenaltyN1(n)+e.getPenaltyN2(n)+e.getPenaltyN3(n)+e.getPenaltyN4(n);e.applyMask(c,n),u<a&&(a=u,l=c)}return l}})(Ct);var q={};const M=$,H=[1,1,1,1,1,1,1,1,1,1,2,2,1,2,2,4,1,2,4,4,2,4,4,4,2,4,6,5,2,4,6,6,2,5,8,8,4,5,8,8,4,5,8,11,4,8,10,11,4,9,12,16,4,9,16,16,6,10,12,18,6,10,17,16,6,11,16,19,6,13,18,21,7,14,21,25,8,16,20,25,8,17,23,25,9,17,23,34,9,18,25,30,10,20,27,32,12,21,29,35,12,23,34,37,12,25,34,40,13,26,35,42,14,28,38,45,15,29,40,48,16,31,43,51,17,33,45,54,18,35,48,57,19,37,51,60,19,38,53,63,20,40,56,66,21,43,59,70,22,45,62,74,24,47,65,77,25,49,68,81],V=[7,10,13,17,10,16,22,28,15,26,36,44,20,36,52,64,26,48,72,88,36,64,96,112,40,72,108,130,48,88,132,156,60,110,160,192,72,130,192,224,80,150,224,264,96,176,260,308,104,198,288,352,120,216,320,384,132,240,360,432,144,280,408,480,168,308,448,532,180,338,504,588,196,364,546,650,224,416,600,700,224,442,644,750,252,476,690,816,270,504,750,900,300,560,810,960,312,588,870,1050,336,644,952,1110,360,700,1020,1200,390,728,1050,1260,420,784,1140,1350,450,812,1200,1440,480,868,1290,1530,510,924,1350,1620,540,980,1440,1710,570,1036,1530,1800,570,1064,1590,1890,600,1120,1680,1980,630,1204,1770,2100,660,1260,1860,2220,720,1316,1950,2310,750,1372,2040,2430];q.getBlocksCount=function(t,i){switch(i){case M.L:return H[(t-1)*4+0];case M.M:return H[(t-1)*4+1];case M.Q:return H[(t-1)*4+2];case M.H:return H[(t-1)*4+3];default:return}};q.getTotalCodewordsCount=function(t,i){switch(i){case M.L:return V[(t-1)*4+0];case M.M:return V[(t-1)*4+1];case M.Q:return V[(t-1)*4+2];case M.H:return V[(t-1)*4+3];default:return}};var bt={},Q={};const F=new Uint8Array(512),J=new Uint8Array(256);(function(){let t=1;for(let i=0;i<255;i++)F[i]=t,J[t]=i,t<<=1,t&256&&(t^=285);for(let i=255;i<512;i++)F[i]=F[i-255]})();Q.log=function(t){if(t<1)throw new Error("log("+t+")");return J[t]};Q.exp=function(t){return F[t]};Q.mul=function(t,i){return t===0||i===0?0:F[J[t]+J[i]]};(function(e){const t=Q;e.mul=function(o,n){const r=new Uint8Array(o.length+n.length-1);for(let s=0;s<o.length;s++)for(let l=0;l<n.length;l++)r[s+l]^=t.mul(o[s],n[l]);return r},e.mod=function(o,n){let r=new Uint8Array(o);for(;r.length-n.length>=0;){const s=r[0];for(let a=0;a<n.length;a++)r[a]^=t.mul(n[a],s);let l=0;for(;l<r.length&&r[l]===0;)l++;r=r.slice(l)}return r},e.generateECPolynomial=function(o){let n=new Uint8Array([1]);for(let r=0;r<o;r++)n=e.mul(n,new Uint8Array([1,t.exp(r)]));return n}})(bt);const Bt=bt;function lt(e){this.genPoly=void 0,this.degree=e,this.degree&&this.initialize(this.degree)}lt.prototype.initialize=function(t){this.degree=t,this.genPoly=Bt.generateECPolynomial(this.degree)};lt.prototype.encode=function(t){if(!this.genPoly)throw new Error("Encoder not initialized");const i=new Uint8Array(t.length+this.degree);i.set(t);const o=Bt.mod(i,this.genPoly),n=this.degree-o.length;if(n>0){const r=new Uint8Array(this.degree);return r.set(o,n),r}return o};var zt=lt,At={},R={},ct={};ct.isValid=function(t){return!isNaN(t)&&t>=1&&t<=40};var v={};const Nt="[0-9]+",Ut="[A-Z $%*+\\-./:]+";let j="(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";j=j.replace(/u/g,"\\u");const Ft="(?:(?![A-Z0-9 $%*+\\-./:]|"+j+`)(?:.|[\r
]))+`;v.KANJI=new RegExp(j,"g");v.BYTE_KANJI=new RegExp("[^A-Z0-9 $%*+\\-./:]+","g");v.BYTE=new RegExp(Ft,"g");v.NUMERIC=new RegExp(Nt,"g");v.ALPHANUMERIC=new RegExp(Ut,"g");const jt=new RegExp("^"+j+"$"),Kt=new RegExp("^"+Nt+"$"),Ot=new RegExp("^[A-Z0-9 $%*+\\-./:]+$");v.testKanji=function(t){return jt.test(t)};v.testNumeric=function(t){return Kt.test(t)};v.testAlphanumeric=function(t){return Ot.test(t)};(function(e){const t=ct,i=v;e.NUMERIC={id:"Numeric",bit:1,ccBits:[10,12,14]},e.ALPHANUMERIC={id:"Alphanumeric",bit:2,ccBits:[9,11,13]},e.BYTE={id:"Byte",bit:4,ccBits:[8,16,16]},e.KANJI={id:"Kanji",bit:8,ccBits:[8,10,12]},e.MIXED={bit:-1},e.getCharCountIndicator=function(r,s){if(!r.ccBits)throw new Error("Invalid mode: "+r);if(!t.isValid(s))throw new Error("Invalid version: "+s);return s>=1&&s<10?r.ccBits[0]:s<27?r.ccBits[1]:r.ccBits[2]},e.getBestModeForData=function(r){return i.testNumeric(r)?e.NUMERIC:i.testAlphanumeric(r)?e.ALPHANUMERIC:i.testKanji(r)?e.KANJI:e.BYTE},e.toString=function(r){if(r&&r.id)return r.id;throw new Error("Invalid mode")},e.isValid=function(r){return r&&r.bit&&r.ccBits};function o(n){if(typeof n!="string")throw new Error("Param is not a string");switch(n.toLowerCase()){case"numeric":return e.NUMERIC;case"alphanumeric":return e.ALPHANUMERIC;case"kanji":return e.KANJI;case"byte":return e.BYTE;default:throw new Error("Unknown mode: "+n)}}e.from=function(r,s){if(e.isValid(r))return r;try{return o(r)}catch{return s}}})(R);(function(e){const t=I,i=q,o=$,n=R,r=ct,s=7973,l=t.getBCHDigit(s);function a(m,f,w){for(let p=1;p<=40;p++)if(f<=e.getCapacity(p,w,m))return p}function c(m,f){return n.getCharCountIndicator(m,f)+4}function u(m,f){let w=0;return m.forEach(function(p){const A=c(p.mode,f);w+=A+p.getBitsLength()}),w}function C(m,f){for(let w=1;w<=40;w++)if(u(m,w)<=e.getCapacity(w,f,n.MIXED))return w}e.from=function(f,w){return r.isValid(f)?parseInt(f,10):w},e.getCapacity=function(f,w,p){if(!r.isValid(f))throw new Error("Invalid QR Code version");typeof p>"u"&&(p=n.BYTE);const A=t.getSymbolTotalCodewords(f),h=i.getTotalCodewordsCount(f,w),y=(A-h)*8;if(p===n.MIXED)return y;const g=y-c(p,f);switch(p){case n.NUMERIC:return Math.floor(g/10*3);case n.ALPHANUMERIC:return Math.floor(g/11*2);case n.KANJI:return Math.floor(g/13);case n.BYTE:default:return Math.floor(g/8)}},e.getBestVersionForData=function(f,w){let p;const A=o.from(w,o.M);if(Array.isArray(f)){if(f.length>1)return C(f,A);if(f.length===0)return 1;p=f[0]}else p=f;return a(p.mode,p.getLength(),A)},e.getEncodedBits=function(f){if(!r.isValid(f)||f<7)throw new Error("Invalid QR Code version");let w=f<<12;for(;t.getBCHDigit(w)-l>=0;)w^=s<<t.getBCHDigit(w)-l;return f<<12|w}})(At);var It={};const ot=I,Pt=1335,Ht=21522,ht=ot.getBCHDigit(Pt);It.getEncodedBits=function(t,i){const o=t.bit<<3|i;let n=o<<10;for(;ot.getBCHDigit(n)-ht>=0;)n^=Pt<<ot.getBCHDigit(n)-ht;return(o<<10|n)^Ht};var Tt={};const Vt=R;function L(e){this.mode=Vt.NUMERIC,this.data=e.toString()}L.getBitsLength=function(t){return 10*Math.floor(t/3)+(t%3?t%3*3+1:0)};L.prototype.getLength=function(){return this.data.length};L.prototype.getBitsLength=function(){return L.getBitsLength(this.data.length)};L.prototype.write=function(t){let i,o,n;for(i=0;i+3<=this.data.length;i+=3)o=this.data.substr(i,3),n=parseInt(o,10),t.put(n,10);const r=this.data.length-i;r>0&&(o=this.data.substr(i),n=parseInt(o,10),t.put(n,r*3+1))};var Jt=L;const Yt=R,Z=["0","1","2","3","4","5","6","7","8","9","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"," ","$","%","*","+","-",".","/",":"];function k(e){this.mode=Yt.ALPHANUMERIC,this.data=e}k.getBitsLength=function(t){return 11*Math.floor(t/2)+6*(t%2)};k.prototype.getLength=function(){return this.data.length};k.prototype.getBitsLength=function(){return k.getBitsLength(this.data.length)};k.prototype.write=function(t){let i;for(i=0;i+2<=this.data.length;i+=2){let o=Z.indexOf(this.data[i])*45;o+=Z.indexOf(this.data[i+1]),t.put(o,11)}this.data.length%2&&t.put(Z.indexOf(this.data[i]),6)};var $t=k;const qt=R;function D(e){this.mode=qt.BYTE,typeof e=="string"?this.data=new TextEncoder().encode(e):this.data=new Uint8Array(e)}D.getBitsLength=function(t){return t*8};D.prototype.getLength=function(){return this.data.length};D.prototype.getBitsLength=function(){return D.getBitsLength(this.data.length)};D.prototype.write=function(e){for(let t=0,i=this.data.length;t<i;t++)e.put(this.data[t],8)};var Qt=D;const Gt=R,Wt=I;function _(e){this.mode=Gt.KANJI,this.data=e}_.getBitsLength=function(t){return t*13};_.prototype.getLength=function(){return this.data.length};_.prototype.getBitsLength=function(){return _.getBitsLength(this.data.length)};_.prototype.write=function(e){let t;for(t=0;t<this.data.length;t++){let i=Wt.toSJIS(this.data[t]);if(i>=33088&&i<=40956)i-=33088;else if(i>=57408&&i<=60351)i-=49472;else throw new Error("Invalid SJIS character: "+this.data[t]+`
Make sure your charset is UTF-8`);i=(i>>>8&255)*192+(i&255),e.put(i,13)}};var Zt=_,vt={exports:{}};(function(e){var t={single_source_shortest_paths:function(i,o,n){var r={},s={};s[o]=0;var l=t.PriorityQueue.make();l.push(o,0);for(var a,c,u,C,m,f,w,p,A;!l.empty();){a=l.pop(),c=a.value,C=a.cost,m=i[c]||{};for(u in m)m.hasOwnProperty(u)&&(f=m[u],w=C+f,p=s[u],A=typeof s[u]>"u",(A||p>w)&&(s[u]=w,l.push(u,w),r[u]=c))}if(typeof n<"u"&&typeof s[n]>"u"){var h=["Could not find a path from ",o," to ",n,"."].join("");throw new Error(h)}return r},extract_shortest_path_from_predecessor_list:function(i,o){for(var n=[],r=o;r;)n.push(r),i[r],r=i[r];return n.reverse(),n},find_path:function(i,o,n){var r=t.single_source_shortest_paths(i,o,n);return t.extract_shortest_path_from_predecessor_list(r,n)},PriorityQueue:{make:function(i){var o=t.PriorityQueue,n={},r;i=i||{};for(r in o)o.hasOwnProperty(r)&&(n[r]=o[r]);return n.queue=[],n.sorter=i.sorter||o.default_sorter,n},default_sorter:function(i,o){return i.cost-o.cost},push:function(i,o){var n={value:i,cost:o};this.queue.push(n),this.queue.sort(this.sorter)},pop:function(){return this.queue.shift()},empty:function(){return this.queue.length===0}}};e.exports=t})(vt);var Xt=vt.exports;(function(e){const t=R,i=Jt,o=$t,n=Qt,r=Zt,s=v,l=I,a=Xt;function c(h){return unescape(encodeURIComponent(h)).length}function u(h,y,g){const d=[];let E;for(;(E=h.exec(g))!==null;)d.push({data:E[0],index:E.index,mode:y,length:E[0].length});return d}function C(h){const y=u(s.NUMERIC,t.NUMERIC,h),g=u(s.ALPHANUMERIC,t.ALPHANUMERIC,h);let d,E;return l.isKanjiModeEnabled()?(d=u(s.BYTE,t.BYTE,h),E=u(s.KANJI,t.KANJI,h)):(d=u(s.BYTE_KANJI,t.BYTE,h),E=[]),y.concat(g,d,E).sort(function(B,P){return B.index-P.index}).map(function(B){return{data:B.data,mode:B.mode,length:B.length}})}function m(h,y){switch(y){case t.NUMERIC:return i.getBitsLength(h);case t.ALPHANUMERIC:return o.getBitsLength(h);case t.KANJI:return r.getBitsLength(h);case t.BYTE:return n.getBitsLength(h)}}function f(h){return h.reduce(function(y,g){const d=y.length-1>=0?y[y.length-1]:null;return d&&d.mode===g.mode?(y[y.length-1].data+=g.data,y):(y.push(g),y)},[])}function w(h){const y=[];for(let g=0;g<h.length;g++){const d=h[g];switch(d.mode){case t.NUMERIC:y.push([d,{data:d.data,mode:t.ALPHANUMERIC,length:d.length},{data:d.data,mode:t.BYTE,length:d.length}]);break;case t.ALPHANUMERIC:y.push([d,{data:d.data,mode:t.BYTE,length:d.length}]);break;case t.KANJI:y.push([d,{data:d.data,mode:t.BYTE,length:c(d.data)}]);break;case t.BYTE:y.push([{data:d.data,mode:t.BYTE,length:c(d.data)}])}}return y}function p(h,y){const g={},d={start:{}};let E=["start"];for(let b=0;b<h.length;b++){const B=h[b],P=[];for(let x=0;x<B.length;x++){const T=B[x],z=""+b+x;P.push(z),g[z]={node:T,lastCount:0},d[z]={};for(let W=0;W<E.length;W++){const S=E[W];g[S]&&g[S].node.mode===T.mode?(d[S][z]=m(g[S].lastCount+T.length,T.mode)-m(g[S].lastCount,T.mode),g[S].lastCount+=T.length):(g[S]&&(g[S].lastCount=T.length),d[S][z]=m(T.length,T.mode)+4+t.getCharCountIndicator(T.mode,y))}}E=P}for(let b=0;b<E.length;b++)d[E[b]].end=0;return{map:d,table:g}}function A(h,y){let g;const d=t.getBestModeForData(h);if(g=t.from(y,d),g!==t.BYTE&&g.bit<d.bit)throw new Error('"'+h+'" cannot be encoded with mode '+t.toString(g)+`.
 Suggested mode is: `+t.toString(d));switch(g===t.KANJI&&!l.isKanjiModeEnabled()&&(g=t.BYTE),g){case t.NUMERIC:return new i(h);case t.ALPHANUMERIC:return new o(h);case t.KANJI:return new r(h);case t.BYTE:return new n(h)}}e.fromArray=function(y){return y.reduce(function(g,d){return typeof d=="string"?g.push(A(d,null)):d.data&&g.push(A(d.data,d.mode)),g},[])},e.fromString=function(y,g){const d=C(y,l.isKanjiModeEnabled()),E=w(d),b=p(E,g),B=a.find_path(b.map,"start","end"),P=[];for(let x=1;x<B.length-1;x++)P.push(b.table[B[x]].node);return e.fromArray(f(P))},e.rawSplit=function(y){return e.fromArray(C(y,l.isKanjiModeEnabled()))}})(Tt);const G=I,X=$,te=kt,ee=Dt,ne=yt,oe=Et,rt=Ct,it=q,re=zt,Y=At,ie=It,se=R,tt=Tt;function ae(e,t){const i=e.size,o=oe.getPositions(t);for(let n=0;n<o.length;n++){const r=o[n][0],s=o[n][1];for(let l=-1;l<=7;l++)if(!(r+l<=-1||i<=r+l))for(let a=-1;a<=7;a++)s+a<=-1||i<=s+a||(l>=0&&l<=6&&(a===0||a===6)||a>=0&&a<=6&&(l===0||l===6)||l>=2&&l<=4&&a>=2&&a<=4?e.set(r+l,s+a,!0,!0):e.set(r+l,s+a,!1,!0))}}function le(e){const t=e.size;for(let i=8;i<t-8;i++){const o=i%2===0;e.set(i,6,o,!0),e.set(6,i,o,!0)}}function ce(e,t){const i=ne.getPositions(t);for(let o=0;o<i.length;o++){const n=i[o][0],r=i[o][1];for(let s=-2;s<=2;s++)for(let l=-2;l<=2;l++)s===-2||s===2||l===-2||l===2||s===0&&l===0?e.set(n+s,r+l,!0,!0):e.set(n+s,r+l,!1,!0)}}function ue(e,t){const i=e.size,o=Y.getEncodedBits(t);let n,r,s;for(let l=0;l<18;l++)n=Math.floor(l/3),r=l%3+i-8-3,s=(o>>l&1)===1,e.set(n,r,s,!0),e.set(r,n,s,!0)}function et(e,t,i){const o=e.size,n=ie.getEncodedBits(t,i);let r,s;for(r=0;r<15;r++)s=(n>>r&1)===1,r<6?e.set(r,8,s,!0):r<8?e.set(r+1,8,s,!0):e.set(o-15+r,8,s,!0),r<8?e.set(8,o-r-1,s,!0):r<9?e.set(8,15-r-1+1,s,!0):e.set(8,15-r-1,s,!0);e.set(o-8,8,1,!0)}function fe(e,t){const i=e.size;let o=-1,n=i-1,r=7,s=0;for(let l=i-1;l>0;l-=2)for(l===6&&l--;;){for(let a=0;a<2;a++)if(!e.isReserved(n,l-a)){let c=!1;s<t.length&&(c=(t[s]>>>r&1)===1),e.set(n,l-a,c),r--,r===-1&&(s++,r=7)}if(n+=o,n<0||i<=n){n-=o,o=-o;break}}}function de(e,t,i){const o=new te;i.forEach(function(a){o.put(a.mode.bit,4),o.put(a.getLength(),se.getCharCountIndicator(a.mode,e)),a.write(o)});const n=G.getSymbolTotalCodewords(e),r=it.getTotalCodewordsCount(e,t),s=(n-r)*8;for(o.getLengthInBits()+4<=s&&o.put(0,4);o.getLengthInBits()%8!==0;)o.putBit(0);const l=(s-o.getLengthInBits())/8;for(let a=0;a<l;a++)o.put(a%2?17:236,8);return ge(o,e,t)}function ge(e,t,i){const o=G.getSymbolTotalCodewords(t),n=it.getTotalCodewordsCount(t,i),r=o-n,s=it.getBlocksCount(t,i),l=o%s,a=s-l,c=Math.floor(o/s),u=Math.floor(r/s),C=u+1,m=c-u,f=new re(m);let w=0;const p=new Array(s),A=new Array(s);let h=0;const y=new Uint8Array(e.buffer);for(let B=0;B<s;B++){const P=B<a?u:C;p[B]=y.slice(w,w+P),A[B]=f.encode(p[B]),w+=P,h=Math.max(h,P)}const g=new Uint8Array(o);let d=0,E,b;for(E=0;E<h;E++)for(b=0;b<s;b++)E<p[b].length&&(g[d++]=p[b][E]);for(E=0;E<m;E++)for(b=0;b<s;b++)g[d++]=A[b][E];return g}function he(e,t,i,o){let n;if(Array.isArray(e))n=tt.fromArray(e);else if(typeof e=="string"){let c=t;if(!c){const u=tt.rawSplit(e);c=Y.getBestVersionForData(u,i)}n=tt.fromString(e,c||40)}else throw new Error("Invalid data");const r=Y.getBestVersionForData(n,i);if(!r)throw new Error("The amount of data is too big to be stored in a QR Code");if(!t)t=r;else if(t<r)throw new Error(`
The chosen QR Code version cannot contain this amount of data.
Minimum version required to store current data is: `+r+`.
`);const s=de(t,i,n),l=G.getSymbolSize(t),a=new ee(l);return ae(a,t),le(a),ce(a,t),et(a,i,0),t>=7&&ue(a,t),fe(a,s),isNaN(o)&&(o=rt.getBestMask(a,et.bind(null,a,i))),rt.applyMask(o,a),et(a,i,o),{modules:a,version:t,errorCorrectionLevel:i,maskPattern:o,segments:n}}wt.create=function(t,i){if(typeof t>"u"||t==="")throw new Error("No input text");let o=X.M,n,r;return typeof i<"u"&&(o=X.from(i.errorCorrectionLevel,X.M),n=Y.from(i.version),r=rt.from(i.maskPattern),i.toSJISFunc&&G.setToSJISFunction(i.toSJISFunc)),he(t,n,o,r)};var St={},ut={};(function(e){function t(i){if(typeof i=="number"&&(i=i.toString()),typeof i!="string")throw new Error("Color should be defined as hex string");let o=i.slice().replace("#","").split("");if(o.length<3||o.length===5||o.length>8)throw new Error("Invalid hex color: "+i);(o.length===3||o.length===4)&&(o=Array.prototype.concat.apply([],o.map(function(r){return[r,r]}))),o.length===6&&o.push("F","F");const n=parseInt(o.join(""),16);return{r:n>>24&255,g:n>>16&255,b:n>>8&255,a:n&255,hex:"#"+o.slice(0,6).join("")}}e.getOptions=function(o){o||(o={}),o.color||(o.color={});const n=typeof o.margin>"u"||o.margin===null||o.margin<0?4:o.margin,r=o.width&&o.width>=21?o.width:void 0,s=o.scale||4;return{width:r,scale:r?4:s,margin:n,color:{dark:t(o.color.dark||"#000000ff"),light:t(o.color.light||"#ffffffff")},type:o.type,rendererOpts:o.rendererOpts||{}}},e.getScale=function(o,n){return n.width&&n.width>=o+n.margin*2?n.width/(o+n.margin*2):n.scale},e.getImageWidth=function(o,n){const r=e.getScale(o,n);return Math.floor((o+n.margin*2)*r)},e.qrToImageData=function(o,n,r){const s=n.modules.size,l=n.modules.data,a=e.getScale(s,r),c=Math.floor((s+r.margin*2)*a),u=r.margin*a,C=[r.color.light,r.color.dark];for(let m=0;m<c;m++)for(let f=0;f<c;f++){let w=(m*c+f)*4,p=r.color.light;if(m>=u&&f>=u&&m<c-u&&f<c-u){const A=Math.floor((m-u)/a),h=Math.floor((f-u)/a);p=C[l[A*s+h]?1:0]}o[w++]=p.r,o[w++]=p.g,o[w++]=p.b,o[w]=p.a}}})(ut);(function(e){const t=ut;function i(n,r,s){n.clearRect(0,0,r.width,r.height),r.style||(r.style={}),r.height=s,r.width=s,r.style.height=s+"px",r.style.width=s+"px"}function o(){try{return document.createElement("canvas")}catch{throw new Error("You need to specify a canvas element")}}e.render=function(r,s,l){let a=l,c=s;typeof a>"u"&&(!s||!s.getContext)&&(a=s,s=void 0),s||(c=o()),a=t.getOptions(a);const u=t.getImageWidth(r.modules.size,a),C=c.getContext("2d"),m=C.createImageData(u,u);return t.qrToImageData(m.data,r,a),i(C,c,u),C.putImageData(m,0,0),c},e.renderToDataURL=function(r,s,l){let a=l;typeof a>"u"&&(!s||!s.getContext)&&(a=s,s=void 0),a||(a={});const c=e.render(r,s,a),u=a.type||"image/png",C=a.rendererOpts||{};return c.toDataURL(u,C.quality)}})(St);var xt={};const me=ut;function mt(e,t){const i=e.a/255,o=t+'="'+e.hex+'"';return i<1?o+" "+t+'-opacity="'+i.toFixed(2).slice(1)+'"':o}function nt(e,t,i){let o=e+t;return typeof i<"u"&&(o+=" "+i),o}function we(e,t,i){let o="",n=0,r=!1,s=0;for(let l=0;l<e.length;l++){const a=Math.floor(l%t),c=Math.floor(l/t);!a&&!r&&(r=!0),e[l]?(s++,l>0&&a>0&&e[l-1]||(o+=r?nt("M",a+i,.5+c+i):nt("m",n,0),n=0,r=!1),a+1<t&&e[l+1]||(o+=nt("h",s),s=0)):n++}return o}xt.render=function(t,i,o){const n=me.getOptions(i),r=t.modules.size,s=t.modules.data,l=r+n.margin*2,a=n.color.light.a?"<path "+mt(n.color.light,"fill")+' d="M0 0h'+l+"v"+l+'H0z"/>':"",c="<path "+mt(n.color.dark,"stroke")+' d="'+we(s,r,n.margin)+'"/>',u='viewBox="0 0 '+l+" "+l+'"',m='<svg xmlns="http://www.w3.org/2000/svg" '+(n.width?'width="'+n.width+'" height="'+n.width+'" ':"")+u+' shape-rendering="crispEdges">'+a+c+`</svg>
`;return typeof o=="function"&&o(null,m),m};const pe=Rt,st=wt,Mt=St,ye=xt;function ft(e,t,i,o,n){const r=[].slice.call(arguments,1),s=r.length,l=typeof r[s-1]=="function";if(!l&&!pe())throw new Error("Callback required as last argument");if(l){if(s<2)throw new Error("Too few arguments provided");s===2?(n=i,i=t,t=o=void 0):s===3&&(t.getContext&&typeof n>"u"?(n=o,o=void 0):(n=o,o=i,i=t,t=void 0))}else{if(s<1)throw new Error("Too few arguments provided");return s===1?(i=t,t=o=void 0):s===2&&!t.getContext&&(o=i,i=t,t=void 0),new Promise(function(a,c){try{const u=st.create(i,o);a(e(u,t,o))}catch(u){c(u)}})}try{const a=st.create(i,o);n(null,e(a,t,o))}catch(a){n(a)}}K.create=st.create;K.toCanvas=ft.bind(null,Mt.render);K.toDataURL=ft.bind(null,Mt.renderToDataURL);K.toString=ft.bind(null,function(e,t,i){return ye.render(e,i)});const U="https://stor1-web.onrender.com";function be(){const e=dt.useRef(null);dt.useEffect(()=>{e.current&&K.toCanvas(e.current,U,{width:300,margin:2,color:{dark:"#1a5632",light:"#ffffff"}})},[]);const t=()=>{const i=window.open("","_blank");i.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Install Omix Store — QR Code</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: #f5f5f5;
          }
          .flyer {
            width: 210mm;
            min-height: 297mm;
            background: white;
            padding: 40px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            position: relative;
            overflow: hidden;
          }
          .flyer::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 8px;
            background: linear-gradient(90deg, #1a5632, #14472a),
          }
          .logo {
            width: 80px;
            height: 80px;
            border-radius: 20px;
            background: linear-gradient(90deg, #1a5632, #14472a),
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 24px;
            box-shadow: 0 8px 30px rgba(255, 56, 92, 0.3);
          }
          .logo span {
            color: white;
            font-size: 36px;
            font-weight: 900;
          }
          h1 {
            font-size: 32px;
            font-weight: 900;
            color: #1a1a1a;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
          }
          .subtitle {
            font-size: 16px;
            color: #666;
            margin-bottom: 32px;
            max-width: 400px;
            line-height: 1.5;
          }
          .qr-container {
            background: white;
            padding: 20px;
            border-radius: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            margin-bottom: 24px;
            border: 2px solid #f0f0f0;
          }
          .qr-container canvas {
            display: block;
          }
          .scan-text {
            font-size: 18px;
            font-weight: 700;
            color: #1a5632;
            margin-bottom: 8px;
          }
          .url {
            font-size: 14px;
            color: #999;
            font-family: monospace;
            margin-bottom: 32px;
          }
          .features {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            width: 100%;
            max-width: 400px;
            margin-bottom: 32px;
          }
          .feature {
            background: #f8f8f8;
            padding: 16px;
            border-radius: 12px;
            text-align: left;
          }
          .feature-icon {
            font-size: 20px;
            margin-bottom: 6px;
          }
          .feature-title {
            font-size: 13px;
            font-weight: 700;
            color: #333;
          }
          .feature-desc {
            font-size: 11px;
            color: #888;
            margin-top: 2px;
          }
          .footer {
            position: absolute;
            bottom: 24px;
            font-size: 12px;
            color: #bbb;
          }
          @media print {
            body { background: white; }
            .flyer { box-shadow: none; }
          }
        </style>
      </head>
      <body>
        <div class="flyer">
          <div class="logo"><img src="${U}/logo.svg" alt="Omix" width="80" height="80" /></div>
          <h1>Install Omix Store</h1>
          <p class="subtitle">Your Online Store in Kericho. Browse products, add to cart, and pay via M-Pesa.</p>
          <div class="qr-container">
            <canvas id="qr-canvas"></canvas>
          </div>
          <p class="scan-text">Scan to Install the App</p>
          <p class="url">${U}</p>
          <div class="features">
            <div class="feature">
              <div class="feature-icon">BROWS</div>
              <div class="feature-title">Browse Products</div>
              <div class="feature-desc">Hundreds of items in stock</div>
            </div>
            <div class="feature">
              <div class="feature-icon">CART</div>
              <div class="feature-title">Easy Cart & Checkout</div>
              <div class="feature-desc">Add items and pay easily</div>
            </div>
            <div class="feature">
              <div class="feature-icon">MPESA</div>
              <div class="feature-title">M-Pesa Payments</div>
              <div class="feature-desc">Pay directly from your phone</div>
            </div>
            <div class="feature">
              <div class="feature-icon">FAST</div>
              <div class="feature-title">Fast Delivery</div>
              <div class="feature-desc">Delivered across Kericho</div>
            </div>
          </div>
          <p class="footer">Omix Store — Your Online Store in Kericho</p>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"><\/script>
        <script>
          QRCode.toCanvas(document.getElementById('qr-canvas'), '${U}', {
            width: 250,
            margin: 2,
            color: { dark: '#1a5632', light: '#ffffff' }
          }, function() {
            setTimeout(function() { window.print(); }, 500);
          });
        <\/script>
      </body>
      </html>
    `),i.document.close()};return N.jsxs("div",{className:"min-h-screen bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-zinc-900 flex flex-col items-center justify-center px-4 py-12",children:[N.jsx("div",{className:"w-20 h-20 rounded-3xl overflow-hidden mb-6 shadow-2xl shadow-[var(--seasonal-primary,#1a5632)]/30",children:N.jsx("img",{src:"/logo.svg",alt:"Omix",className:"w-full h-full"})}),N.jsx("h1",{className:"text-3xl md:text-4xl font-black text-white mb-2 tracking-tight text-center",children:"Install Omix Store"}),N.jsx("p",{className:"text-zinc-400 mb-8 text-center max-w-md",children:"Scan this QR code with your phone camera to install the Omix app on your device."}),N.jsx("div",{className:"bg-white p-6 rounded-3xl shadow-xl shadow-zinc-200/50 dark:shadow-none border border-zinc-800 mb-6",children:N.jsx("canvas",{ref:e,className:"block"})}),N.jsx("p",{className:"text-sm font-bold text-[var(--seasonal-primary,#1a5632)] mb-1",children:"Scan to Install the App"}),N.jsx("p",{className:"text-xs text-zinc-400 font-mono mb-8",children:U}),N.jsxs("div",{className:"flex flex-col sm:flex-row gap-3 w-full max-w-sm",children:[N.jsx("button",{onClick:t,className:"flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-[var(--seasonal-primary,#1a5632)] to-[var(--seasonal-secondary,#14472a)] text-white px-6 py-3.5 rounded-2xl font-black shadow-xl shadow-[var(--seasonal-primary,#1a5632)]/25 hover:shadow-[var(--seasonal-primary,#1a5632)]/40 transition-all hover:scale-105 active:scale-95 text-sm",children:"Download Print Flyer"}),N.jsx("a",{href:"/install",className:"flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl font-bold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-all text-sm",children:"Install Directly"})]}),N.jsx("div",{className:"grid grid-cols-2 gap-3 mt-10 max-w-md w-full",children:[{title:"Browse Products",desc:"Hundreds of items"},{title:"M-Pesa Payments",desc:"Pay from your phone"},{title:"Fast Delivery",desc:"Across Kericho"},{title:"Full Screen App",desc:"Works like native"}].map((i,o)=>N.jsxs("div",{className:"bg-zinc-900 rounded-xl p-4 text-center border border-zinc-100 dark:border-zinc-800",children:[N.jsx("h3",{className:"font-bold text-white text-sm",children:i.title}),N.jsx("p",{className:"text-xs text-zinc-400 mt-0.5",children:i.desc})]},o))})]})}export{be as default};
