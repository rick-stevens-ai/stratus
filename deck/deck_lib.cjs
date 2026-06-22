// Shared deck library — palette, helpers, and DIAGRAM primitives.
// HARD RULE: no fontSize below 16 anywhere (footers included).
// pptxgenjs is resolved from the deck/ node_modules or a global install.
let PptxGenJS;
try { PptxGenJS = require("pptxgenjs"); }
catch (e) {
  const cp = require("child_process");
  const g = cp.execSync("npm root -g").toString().trim();
  PptxGenJS = require(require("path").join(g, "pptxgenjs"));
}

const C = {
  NAVY:"0B1F3A", NAVY2:"13294B", TEAL:"1C7293", CYAN:"33C3F0", ICE:"CADCFC",
  PAPER:"F5F8FC", INK:"14202E", GREY:"55657A", GOLD:"F2B134", GREEN:"3BA776",
  RED:"C0444A", AMBER:"B8860B", WHITE:"FFFFFF", LINE:"D8E2EE"
};
const HF="Georgia", BF="Calibri";
let T; // ShapeType, set per pptx

function makeLib(pptx){
  T = pptx.ShapeType;
  return {
    bgDark:(s)=>{ s.background={color:C.NAVY}; },
    bgLight:(s)=>{ s.background={color:C.PAPER}; },
    kicker:(s,t,c)=> s.addText(t.toUpperCase(),{x:0.7,y:0.5,w:11.9,h:0.45,fontFace:BF,fontSize:17,color:c||C.CYAN,bold:true,charSpacing:2}),
    title:(s,t,c)=> s.addText(t,{x:0.7,y:0.98,w:11.9,h:1.0,fontFace:HF,fontSize:40,bold:true,color:c||C.INK}),
    foot:(s,n,total,dark)=>{
      s.addText(String(n).padStart(2,"0")+" / "+total,{x:11.4,y:6.95,w:1.6,h:0.35,fontFace:BF,fontSize:16,color:dark?C.ICE:C.GREY,align:"right"});
    },
    // card: header 19pt, body 16pt min
    card:(s,x,y,w,h,head,body,o)=>{
      o=o||{};
      s.addShape(T.roundRect,{x,y,w,h,rectRadius:0.09,fill:{color:o.fill||C.WHITE},line:{color:o.line||C.LINE,width:1},shadow:{type:"outer",color:"9FB0C0",blur:5,offset:2,angle:90,opacity:0.3}});
      s.addShape(T.roundRect,{x,y,w:0.14,h,rectRadius:0.05,fill:{color:o.accent||C.CYAN},line:{type:"none"}});
      if(head) s.addText(head,{x:x+0.34,y:y+0.18,w:w-0.6,h:0.5,fontFace:BF,fontSize:o.hsize||19,bold:true,color:o.hcolor||C.INK});
      if(body) s.addText(body,{x:x+0.34,y:y+(head?0.8:0.22),w:w-0.62,h:h-(head?0.95:0.4),fontFace:BF,fontSize:o.bsize||16,color:o.bcolor||"33414F",valign:"top",lineSpacingMultiple:1.12});
    },
    bigstat:(s,x,y,w,big,label,color)=>{
      s.addText(big,{x,y,w,h:1.15,fontFace:HF,fontSize:62,bold:true,color:color||C.CYAN,align:"center"});
      s.addText(label,{x,y:y+1.15,w,h:0.5,fontFace:BF,fontSize:17,color:C.GREY,align:"center",bold:true});
    },
    // ---------- DIAGRAM PRIMITIVES ----------
    // a labeled node box
    node:(s,x,y,w,h,label,o)=>{
      o=o||{};
      s.addShape(T.roundRect,{x,y,w,h,rectRadius:0.1,fill:{color:o.fill||C.NAVY2},line:{color:o.line||C.CYAN,width:o.lw||2}});
      if(o.tag){
        s.addShape(T.roundRect,{x,y,w,h:0.5,rectRadius:0.1,fill:{color:o.line||C.CYAN},line:{type:"none"}});
        s.addText(o.tag,{x,y,w,h:0.5,fontFace:BF,fontSize:16,bold:true,color:C.NAVY,align:"center",valign:"middle"});
        s.addText(label,{x:x+0.15,y:y+0.55,w:w-0.3,h:h-0.65,fontFace:BF,fontSize:o.size||16,color:o.tc||C.ICE,align:"center",valign:"middle",lineSpacingMultiple:1.1});
      } else {
        s.addText(label,{x:x+0.12,y:y+0.06,w:w-0.24,h:h-0.12,fontFace:BF,fontSize:o.size||16,bold:o.bold!==false,color:o.tc||C.WHITE,align:"center",valign:"middle",lineSpacingMultiple:1.08});
      }
    },
    // arrow between two points (horizontal or vertical) using a line + glyph
    arrowRight:(s,x,y,len,color)=>{
      s.addShape(T.line,{x,y,w:len,h:0,line:{color:color||C.CYAN,width:3,endArrowType:"triangle"}});
    },
    arrowDown:(s,x,y,len,color)=>{
      s.addShape(T.line,{x,y,w:0,h:len,line:{color:color||C.CYAN,width:3,endArrowType:"triangle"}});
    },
    chev:(s,x,y,color)=> s.addText("\u203a",{x,y,w:0.55,h:0.9,fontFace:HF,fontSize:44,bold:true,color:color||C.CYAN,align:"center",valign:"middle"}),
    pill:(s,x,y,w,h,txt,fill,tc)=>{
      s.addShape(T.roundRect,{x,y,w,h,rectRadius:h/2,fill:{color:fill},line:{type:"none"}});
      s.addText(txt,{x,y,w,h,fontFace:BF,fontSize:16,bold:true,color:tc||C.WHITE,align:"center",valign:"middle"});
    },
    cyl:(s,x,y,w,h,label,color)=>{ // database cylinder via ellipse+rect
      const col=color||C.TEAL;
      s.addShape(T.roundRect,{x,y:y+0.18,w,h:h-0.36,fill:{color:col},line:{type:"none"}});
      s.addShape(T.ellipse,{x,y,w,h:0.36,fill:{color:col},line:{color:C.WHITE,width:1}});
      s.addShape(T.ellipse,{x,y:y+h-0.36,w,h:0.36,fill:{color:col},line:{type:"none"}});
      s.addText(label,{x:x-0.1,y:y+h+0.05,w:w+0.2,h:0.6,fontFace:BF,fontSize:16,bold:true,color:C.INK,align:"center"});
    }
  };
}
module.exports = { C, HF, BF, makeLib, PptxGenJS };
