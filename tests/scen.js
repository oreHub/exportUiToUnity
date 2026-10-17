const path=require('path');const {analyze}=require(path.join(__dirname,'..','plugin','UIExport','core','analyze.js'));const fs=require('fs');
const base=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','Home.layers.json')));
const find=(n,id)=>{if(n.id===id)return n;for(const c of n.children){const x=find(c,id);if(x)return x}};
const A=(name,bbox,vis=false)=>({name,group:false,text:false,psd_kind:'shape',visible:vis,opacity:1,has_fx:false,bbox,children:[]});
const show=(r,ids,codes)=>{for(const id of ids){const n=find(r.tree,id);console.log(' ',id,n.rect,n.rect_source,n.frame_from||n.group_area_from||'',n.children.map(c=>c.name+':'+c.rect_source+(c.text_box_from?'('+c.text_box_from+')':'')).join(' '))}
  r.issues.filter(i=>codes.includes(i.code)).forEach(i=>console.log('  ',i.level,i.message))};
const codes=['area_conflict','area_outside','area_order','text_overflow'];
// 1. PlayerLv_Grp
{const d=base();const g=d.layers.find(l=>l.name==='Header_InfoChr_Grp_Prefab');const pick=['area_LvNum','10','area_lv','Lv.'];
 const kids=g.children.filter(c=>pick.includes(c.name));const i0=g.children.indexOf(kids[0]);g.children=g.children.filter(c=>!pick.includes(c.name));
 g.children.splice(i0,0,{name:'PlayerLv_Grp',group:true,text:false,psd_kind:'group',visible:true,opacity:1,has_fx:false,bbox:[0,0,0,0],children:[A('area_PlayerLv',[481,40,81,27]),...kids]});
 console.log('1. PlayerLv_Grp（area_PlayerLv を一番下に）');show(analyze(d),['PlayerLv'],codes);
 const d2=JSON.parse(JSON.stringify(d));const pg=d2.layers.find(l=>l.name==='Header_InfoChr_Grp_Prefab').children.find(c=>c.name==='PlayerLv_Grp');pg.children[0].name='area_Box';
 console.log('1b. 名前が違う area_Box');show(analyze(d2),['PlayerLv'],codes);}
// 2. 画像の枠: Icon_Footer_Gacha に area_Icon_Footer_Gacha
{const d=base();const b=d.layers.find(l=>l.name==='Footer_List').children.find(c=>c.name==='Btn_Footer_Gacha_Prefab');
 b.children.unshift(A('area_Icon_Footer_Gacha',[426,918,102,102]));console.log('2. 画像の枠');show(analyze(d),['Btn_Footer_Gacha'],codes);}
// 3. 並べ忘れ: area_LvNum を一番下へ
{const d=base();const g=d.layers.find(l=>l.name==='Header_InfoChr_Grp_Prefab');const a=g.children.find(c=>c.name==='area_LvNum');g.children=g.children.filter(c=>c!==a);g.children.unshift(a);
 console.log('3. area_LvNum を文字から離した');show(analyze(d),['Header_InfoChr'],codes);}
// 4. _Img に area_
{const d=base();const m=d.layers.find(l=>l.name==='Header_Info_Grp').children.find(c=>c.name==='Btn_Menu_Grp').children.find(c=>c.name==='Icon_Menu_Img');
 m.children.unshift(A('area_icon',[1846,48,32,32]));console.log('4. _Img の中に area_');show(analyze(d),['Btn_Menu'],codes);}
// 5. グループの外の同名 area_
{const d=base();const g=d.layers.find(l=>l.name==='Header_Info_Grp');g.children.push(A('area_Btn_Menu',[1836,38,52,52]));console.log('5. グループの外に area_Btn_Menu');show(analyze(d),['Header_Info'],codes);}
