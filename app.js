/* Agenda de Obra — aplicación local. Datos e imágenes permanecen en IndexedDB. */
const DB_NAME='agenda-obra-v1', STORE=['works','tasks','activities','workers','crews','photos','settings'], NOTE_PREFIX='note:', MATERIAL_PREFIX='material:', ATTENDANCE_PREFIX='attendance:', ATTENDANCE_CREW_PREFIX='attendance-crew:', FIELD_TOOL_PREFIX='field-tool:';
let attendanceWeek='', attendancePending=0, attendanceCrewSelection='';
let journalDay='';
let materialsDay='';
let db, page='home', activeWork='', workChosen=false, filterWork='all', filterDate='', toastTimer, installPrompt;
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Date().toISOString().slice(0,10), dateFmt=d=>d?new Date(`${d}T12:00:00`).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}):'—', dateTimeFmt=d=>d?new Date(d).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'}):'—', uid=()=>crypto.randomUUID();
function openDB(){return new Promise((resolve,reject)=>{let r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{for(const s of STORE)if(!r.result.objectStoreNames.contains(s))r.result.createObjectStore(s,{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function all(s){return new Promise((res,rej)=>{let r=db.transaction(s).objectStore(s).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}function get(s,id){return new Promise((res,rej)=>{let r=db.transaction(s).objectStore(s).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}function put(s,x){return new Promise((res,rej)=>{let t=db.transaction(s,'readwrite');t.objectStore(s).put(x);t.oncomplete=()=>res(x);t.onerror=()=>rej(t.error)})}function del(s,id){return new Promise((res,rej)=>{let t=db.transaction(s,'readwrite');t.objectStore(s).delete(id);t.oncomplete=res;t.onerror=()=>rej(t.error)})}
const works=()=>all('works'), records=async s=>(await all(s)).filter(x=>!x.deletedAt), workName=id=>window._works?.find(w=>w.id===id)?.name||'Obra archivada';
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2600)}
function field(label,name,value='',type='text',extra=''){return `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`}function area(label,name,value=''){return `<div class="field"><label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}">${esc(value)}</textarea></div>`}function select(label,name,options,value=''){return `<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`}
function workOptions(value=activeWork,includeAll=false){let ws=window._works||[];return (includeAll?[['all','Todas las obras']]:[]).concat(ws.map(w=>[w.id,w.name]))}
function modal(title,body,saveLabel='Guardar',onSave=null){let m=$('#modal');m.innerHTML=`<div class="dialog"><div class="dialog-head"><h2>${title}</h2><button class="close" data-close>×</button></div><form id="form">${body}<div class="dialog-actions"><button type="button" class="btn light" data-close>Cancelar</button><button class="btn" type="submit">${saveLabel}</button></div></form></div>`;m.classList.remove('hidden');m.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>m.classList.add('hidden'));m.onclick=e=>{if(e.target===m)m.classList.add('hidden')};if(onSave)m.querySelector('form').onsubmit=async e=>{e.preventDefault();let fd=Object.fromEntries(new FormData(e.currentTarget));try{await onSave(fd,e.currentTarget);m.classList.add('hidden');await render();}catch(err){console.error(err);toast('No se pudo guardar: '+(err.message||'error'))}}}
function workForm(item={}){modal(item.id?'Editar obra':'Nueva obra',field('Nombre de la obra','name',item.name||'','text','required')+field('Ubicación o localidad','location',item.location||'')+`<div class="form-grid">${field('Fecha de inicio','startDate',item.startDate||today(),'date','required')}${field('Término previsto (opcional)','endDate',item.endDate||'','date')}</div>`+area('Descripción y observaciones','notes',item.notes||'')+select('Estado','status',[['activa','Activa'],['terminada','Terminada']],item.status||'activa'),item.id?'Guardar cambios':'Crear obra',async f=>{let v={...item,...f,id:item.id||uid(),createdAt:item.createdAt||new Date().toISOString()};await put('works',v);if(!activeWork||!item.id){activeWork=v.id;await put('settings',{id:'activeWork',value:activeWork});workChosen=true}toast('Obra guardada')})}
async function journalNotes(workId){return (await all('settings')).filter(x=>typeof x.id==='string'&&x.id.startsWith(NOTE_PREFIX)&&x.value?.kind==='journal-note'&&x.value.workId===workId).map(x=>x.value).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))}
function journalLocalDate(value=new Date()){
 const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))return '';
 return `${String(d.getFullYear()).padStart(4,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function journalShiftDay(date,offset){const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+offset);return journalLocalDate(d)}
function journalValidDay(date){return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&journalShiftDay(date,0)===date}
function journalEntryDay(item){return journalValidDay(item.agendaDate)?item.agendaDate:journalLocalDate(item.createdAt)}
function journalLongDate(date){return new Date(`${date}T12:00:00`).toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
// Reglas conservadoras: una sola fecha inicial y una acción reconocible, sin servicios externos.
function journalFold(text){return text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function journalFutureAction(text){
 const verbs='llevar|traer|revisar|checar|recibir|entregar|comprar|pedir|solicitar|confirmar|verificar|supervisar|inspeccionar|preparar|realizar|hacer|instalar|colocar|colar|medir|limpiar|retirar|reparar|terminar|iniciar|continuar|coordinar|programar|llamar|enviar|visitar|recoger|cargar|descargar|transportar|nivelar|excavar|rellenar|compactar|pintar|impermeabilizar|cotizar|conseguir|llevarse|reunir|reunirse|asistir|pagar|apartar|reservar|reponer|llegar';
 const value=journalFold(text).replace(/^(?:(?:hay que|tengo que|tenemos que|debo|debemos|se debe|se deben|necesito|necesitamos|voy a|vamos a|se va a|recordar|no olvidar)\s+|no\s+)/,'');
 const imperatives='lleva|trae|revisa|checa|recibe|entrega|compra|pide|solicita|confirma|verifica|prepara|realiza|haz|instala|coloca|mide|limpia|retira|repara|llama|envia|recoge';
 return !/[?¿]/.test(text)&&new RegExp(`^(?:(?:${verbs})(?:e|as|a|emos|eis|an)?|${imperatives})\\b`).test(value);
}
function journalExplicitDateAtStart(text,reference){
 const weekdays='lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo';
 let match=String(text).match(new RegExp('^\\s*(?:('+weekdays+')\\s+)?(\\d{1,2})\\s+de\\s+([a-záéíóúñ]+)(?:\\s+(?:de(?:l)?\\s+)?(\\d{4})(?!\\d))?(?=[\\s,:;.—-]|$)','i'));
 if(match){
 const months={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12},month=months[journalFold(match[3])];
 if(!month)return {length:match[0].length,warning:'No se programó: no se reconoce el mes escrito.'};
 const dueDate=(match[4]||reference.slice(0,4))+'-'+String(month).padStart(2,'0')+'-'+match[2].padStart(2,'0');
 if(!journalValidDay(dueDate))return {length:match[0].length,warning:'No se programó: la fecha escrita no existe.'};
 if(match[1]&&['domingo','lunes','martes','miercoles','jueves','viernes','sabado'][new Date(dueDate+'T12:00:00').getDay()]!==journalFold(match[1]))return {length:match[0].length,warning:'No se programó: el día de la semana no coincide con la fecha.'};
 return {length:match[0].length,dueDate};
 }
 match=String(text).match(new RegExp('^\\s*(?:('+weekdays+')\\s+)?(\\d{1,2})[/-](\\d{1,2})[/-](\\d{4})(?!\\d)(?=[\\s,:;.—-]|$)','i'));
 if(!match)return null;
 const dueDate=match[4]+'-'+match[3].padStart(2,'0')+'-'+match[2].padStart(2,'0');
 if(!journalValidDay(dueDate))return {length:match[0].length,warning:'No se programó: la fecha escrita no existe.'};
 if(match[1]&&['domingo','lunes','martes','miercoles','jueves','viernes','sabado'][new Date(dueDate+'T12:00:00').getDay()]!==journalFold(match[1]))return {length:match[0].length,warning:'No se programó: el día de la semana no coincide con la fecha.'};
 return {length:match[0].length,dueDate};
}
function journalInterpret(text,reference){
 const none={warning:''},warn=warning=>({warning});if(!journalValidDay(reference))return warn('No se programó: la fecha de la página no es válida.');
 const weekdays='lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo',lead='(?:(?:el|para(?: el)?)\\s+)?',separator='(?:[\\s,:;.—-]+|$)';
 let dueDate='',weekday='',rest='',match=text.trim().match(/^(?:(?:para|el)\s+)?(pasado\s+ma[ñn]ana|ma[ñn]ana|hoy)\b[\s,:;.—-]*/i);
 if(match){
  const relative=journalFold(match[1]).replace(/\s+/g,' ');if(relative==='hoy')return none;
  dueDate=journalShiftDay(reference,relative==='pasado manana'?2:1);rest=text.trim().slice(match[0].length);
  const explicit=journalExplicitDateAtStart(rest,reference);
  if(explicit){if(explicit.warning)return warn(explicit.warning);if(explicit.dueDate!==dueDate)return warn('No se programó: la fecha relativa y la fecha escrita se contradicen.');rest=rest.slice(explicit.length).replace(/^[\s,:;.—-]+/,'')}
 }else{
  const numeric=new RegExp(`^${lead}(?:(${weekdays})\\s+)?(\\d{1,2})/(\\d{1,2})/(\\d{4})(?!\\d)${separator}`,'i');
  const written=new RegExp(`^${lead}(?:(${weekdays})\\s+)?(\\d{1,2})\\s+de\\s+([a-záéíóúñ]+)(?:\\s+(?:de(?:l)?\\s+)?(\\d{4})(?!\\d))?${separator}`,'i');
  match=text.trim().match(numeric);
  if(match){weekday=match[1]||'';dueDate=`${match[4]}-${match[3].padStart(2,'0')}-${match[2].padStart(2,'0')}`}
  else{
   match=text.trim().match(written);
   if(match){
    const months={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12},month=months[journalFold(match[3])];
    if(!month)return warn('No se programó: no se reconoce el mes escrito.');
    weekday=match[1]||'';dueDate=`${match[4]||reference.slice(0,4)}-${String(month).padStart(2,'0')}-${match[2].padStart(2,'0')}`;
   }
  }
  if(!match){
   const possible=new RegExp(`^${lead}(?:${weekdays}|\\d{1,2}\\b|(?:la\\s+)?pr[oó]xima\\s+(?:semana|fecha))`,'i');
   return possible.test(text.trim())?warn('No se programó: escribe una fecha completa, como 25 de octubre o 03/11/2026.'):none;
  }
  rest=text.trim().slice(match[0].length);
 }
 if(!journalValidDay(dueDate))return warn('No se programó: la fecha escrita no existe.');
 if(weekday&&['domingo','lunes','martes','miercoles','jueves','viernes','sabado'][new Date(`${dueDate}T12:00:00`).getDay()]!==journalFold(weekday))return warn('No se programó: el día de la semana no coincide con la fecha.');
 const anotherDate=new RegExp(`\\b(?:pasado\\s+ma[ñn]ana|ma[ñn]ana|hoy|${weekdays})\\b|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{1,2}\\s+de\\s+[a-záéíóúñ]+`,'i');
 if(anotherDate.test(rest)||/^(?:de(?:l)?\s+)?\d+\b/.test(rest))return warn('No se programó: hay varias fechas o una indicación de fecha incompleta.');
 if(dueDate<reference)return warn('No se programó: la fecha es anterior a esta página. Se mantuvo el año escrito o el de la página.');
 if(dueDate===reference||!journalFutureAction(rest))return none;
 const title=rest.trim();return {dueDate,title:title.charAt(0).toLocaleUpperCase('es-MX')+title.slice(1),warning:''};
}
async function saveJournalNote(text,agendaDate=journalLocalDate(),workId=activeWork,id=uid()){
 if(!journalValidDay(agendaDate))throw Error('La fecha de la agenda no es válida');
 const plan=journalInterpret(text,agendaDate),value={kind:'journal-note',id,workId,text,agendaDate,createdAt:new Date().toISOString()},row={id:NOTE_PREFIX+id,value};
 if(plan.warning)value.schedulingWarning=plan.warning;
 const task=plan.dueDate?{id:'note-task:'+id,sourceNoteId:id,workId,title:plan.title,description:'',dueDate:plan.dueDate,dueTime:'',priority:'media',status:'pendiente',followup:'',createdAt:value.createdAt,updatedAt:value.createdAt}:null;
 if(task)value.linkedTaskId=task.id;
 const existing=await get('settings',row.id);
 if(existing){if(existing.value?.kind==='journal-note'&&existing.value.text===text&&existing.value.workId===workId&&existing.value.agendaDate===agendaDate)return existing.value;throw Error('La clave de la nota ya existe; no se sobrescribió ningún registro')}
 // Nota y tarea se confirman juntas; add evita sobrescribir claves existentes.
 await new Promise((resolve,reject)=>{const transaction=db.transaction(task?['settings','tasks']:['settings'],'readwrite');transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error||Error('No se pudo guardar la anotación'));transaction.onerror=()=>{};transaction.objectStore('settings').add(row);if(task)transaction.objectStore('tasks').add(task)});
 const saved=await get('settings',row.id);
 if(!saved||saved.id!==row.id||saved.value?.kind!=='journal-note'||saved.value?.id!==id||saved.value?.workId!==workId||saved.value?.text!==text||saved.value?.agendaDate!==agendaDate||saved.value?.createdAt!==value.createdAt)throw Error('No se pudo verificar la nota guardada');
 if(task){const linked=await get('tasks',task.id);if(linked?.sourceNoteId!==id||linked.workId!==workId||linked.title!==task.title||linked.dueDate!==task.dueDate)throw Error('No se pudo verificar la tarea vinculada')}
 return saved.value;
}
async function updateJournalNote(note,text){
 const value=String(text||'').trim();if(!value)throw Error('Escribe una nota antes de guardar');
 const key=NOTE_PREFIX+note.id,current=await get('settings',key);
 if(!current||current.value?.kind!=='journal-note'||current.value.id!==note.id||current.value.workId!==note.workId)throw Error('La anotación ya no está disponible en esta obra');
 const now=new Date().toISOString(),updated={...current.value,text:value,updatedAt:now};
 const linked=current.value.linkedTaskId?await get('tasks',current.value.linkedTaskId):null;
 const validLinked=linked&&linked.workId===current.value.workId&&linked.sourceNoteId===current.value.id&&!linked.deletedAt;
 let task=null;
 if(validLinked){
  // La nota puede cambiar, pero la tarea vinculada solo se modifica desde su editor.
  delete updated.schedulingWarning;
 }else{
  const plan=journalInterpret(value,current.value.agendaDate);
  delete updated.schedulingWarning;
  if(plan.warning)updated.schedulingWarning=plan.warning;
  if(plan.dueDate){
   const taskId='note-task:'+current.value.id,existingTask=await get('tasks',taskId);
   const alreadyLinked=existingTask||((await all('tasks')).find(t=>t.sourceNoteId===current.value.id&&t.workId===current.value.workId));
   if(alreadyLinked){
    if(alreadyLinked.sourceNoteId!==current.value.id||alreadyLinked.workId!==current.value.workId)throw Error('Ya existe un registro con la clave de esta tarea; no se modificó');
    updated.linkedTaskId=alreadyLinked.id;delete updated.schedulingWarning;
   }else{
    task={id:taskId,sourceNoteId:current.value.id,workId:current.value.workId,title:plan.title,description:'',dueDate:plan.dueDate,dueTime:'',priority:'media',status:'pendiente',followup:'',createdAt:now,updatedAt:now};
    updated.linkedTaskId=taskId;
   }
  }
 }
 const row={...current,value:updated};
 if(task){
  await new Promise((resolve,reject)=>{const transaction=db.transaction(['settings','tasks'],'readwrite');transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error||Error('No se pudo guardar la anotación y su tarea'));transaction.onerror=()=>{};transaction.objectStore('settings').put(row);transaction.objectStore('tasks').add(task)});
 }else await put('settings',row);
 const saved=await get('settings',key);
 if(!saved||saved.id!==key||saved.value?.id!==note.id||saved.value.workId!==note.workId||saved.value.agendaDate!==current.value.agendaDate||saved.value.createdAt!==current.value.createdAt||saved.value.text!==value||saved.value.updatedAt!==now)throw Error('No se pudo verificar el cambio');
 if(task){const linkedAfter=await get('tasks',task.id);if(linkedAfter?.sourceNoteId!==note.id||linkedAfter.workId!==note.workId||linkedAfter.title!==task.title||linkedAfter.dueDate!==task.dueDate)throw Error('No se pudo verificar la tarea vinculada')}
 return saved.value;
}
async function deleteJournalNote(note){
 const key=NOTE_PREFIX+note.id,current=await get('settings',key);
 if(!current||current.value?.kind!=='journal-note'||current.value.id!==note.id||current.value.workId!==note.workId)throw Error('La anotación ya no está disponible en esta obra');
 await del('settings',key);
 if(await get('settings',key))throw Error('No se pudo verificar la eliminación');
}
async function confirmAndDeleteJournalNote(note,confirmFn=confirm){
 if(!confirmFn('¿Deseas eliminar esta anotación?'))return false;
 await deleteJournalNote(note);return true;
}
function journalLinkedTaskChanged(note,task){
 const plan=journalInterpret(note.text,note.agendaDate);
 return !plan.dueDate||plan.dueDate!==task.dueDate||journalFold(plan.title)!==journalFold(task.title);
}
async function openJournalNoteMenu(id){
 const row=await get('settings',NOTE_PREFIX+id);
 if(!row||row.value?.kind!=='journal-note'||row.value.id!==id){toast('La anotación ya no está disponible');return}
 const m=$('#modal');m.innerHTML=`<div class="dialog journal-note-menu-dialog"><div class="dialog-head"><h2>Opciones de anotación</h2><button class="close" data-close aria-label="Cerrar">×</button></div><p class="subtle">${esc(journalLongDate(row.value.agendaDate))}</p><div class="journal-note-menu-actions"><button class="btn" type="button" data-edit-note>Editar</button><button class="btn danger small" type="button" data-delete-note>Eliminar</button><button class="btn light" type="button" data-close>Cancelar</button></div></div>`;m.classList.remove('hidden');m.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>m.classList.add('hidden'));m.onclick=e=>{if(e.target===m)m.classList.add('hidden')};m.querySelector('[data-edit-note]').onclick=()=>journalNoteEditForm(row.value);m.querySelector('[data-delete-note]').onclick=()=>action('delete-journal-note',row.value.id);
}
async function journalNoteEditForm(note){
 const linked=note.linkedTaskId?await get('tasks',note.linkedTaskId):null;
 const validTask=linked&&linked.workId===note.workId&&linked.sourceNoteId===note.id&&!linked.deletedAt?linked:null;
 const linkNotice=validTask?`<div class="inline-note journal-note-link-notice" role="status">Esta nota conserva la tarea «${esc(validTask.title)}»${validTask.dueDate?' ('+esc(dateFmt(validTask.dueDate))+')':''}. Editar la nota no crea otra tarea ni modifica la existente. Si el texto cambia su fecha o descripción, guarda la nota y después usa «Editar / reprogramar tarea» en esta página.</div>`:'<div class="inline-note" role="note">Editar una anotación no crea tareas automáticamente.</div>';
 modal('Editar anotación',`<p class="subtle">${esc(workName(note.workId))} · ${esc(journalLongDate(note.agendaDate))}</p><div class="field"><label for="f-noteText">Anotación</label><textarea id="f-noteText" name="text" rows="6" maxlength="5000" required>${esc(note.text)}</textarea></div>${linkNotice}`,'Guardar cambios',async f=>{await updateJournalNote(note,f.text);toast('Anotación actualizada; su fecha original y vínculo se conservaron')});
 const area=$('#modal [name="text"]');if(validTask){const notice=$('#modal .journal-note-link-notice');area.oninput=()=>{const proposed={...note,text:area.value};notice.dataset.changed=journalLinkedTaskChanged(proposed,validTask)?'yes':'no';notice.textContent=notice.dataset.changed==='yes'?'El texto ahora sugiere una fecha o descripción distinta. La tarea existente queda intacta. Guarda la nota y luego elige «Editar / reprogramar tarea» en esta página si deseas cambiarla.':'Esta nota conserva la tarea vinculada. Editar la nota no crea otra tarea ni modifica la existente.'}}
}
function journalNoteForm(){
 if(!activeWork||!workChosen){toast('Primero selecciona una obra');page='home';return render()}
 const date=page==='journal'?(journalDay||journalLocalDate()):journalLocalDate(),workId=activeWork,draftId=uid();
 modal('Nueva anotación',`<p class="subtle">${esc(workName(workId))}<br>Agenda: ${esc(journalLongDate(date))}.<br>Puedes escribir, por ejemplo: «Mañana llevar herramienta».</p><div class="field"><label for="f-noteText">Anotación</label><textarea id="f-noteText" name="text" rows="6" maxlength="5000" placeholder="Escribe aquí lo que quieras recordar…" required></textarea></div>`,'Guardar anotación',async(f,form)=>{
  const text=f.text.trim();if(!text)throw Error('Escribe una nota antes de guardar');
  const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{const saved=await saveJournalNote(text,date,workId,draftId);toast(saved.linkedTaskId?'Anotación y tarea guardadas':saved.schedulingWarning?'Nota guardada; revisa el aviso de fecha':'Nota guardada y verificada')}
  finally{button.disabled=false}
 });
}
async function saveJournalTask(fields,id='',workId=activeWork){
 const title=fields.title.trim(),dueDate=fields.dueDate,dueTime=fields.dueTime||'';
 if(!title)throw Error('Escribe la descripción de la tarea');
 if(!journalValidDay(dueDate))throw Error('Elige una fecha válida');
 if(dueTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime))throw Error('Revisa la hora programada');
 const existing=id?await get('tasks',id):null;
 if(id&&(!existing||existing.workId!==workId||existing.deletedAt))throw Error('La tarea no está disponible en esta obra');
 if(existing?.status==='terminado')throw Error('Deja la tarea pendiente antes de reprogramarla');
 const now=new Date().toISOString(),value={...existing,id:id||uid(),workId,title,description:existing?.description||'',dueDate,dueTime,priority:existing?.priority||'media',status:existing?.status||'pendiente',followup:existing?.followup||'',createdAt:existing?.createdAt||now,updatedAt:now};
 if(!id&&await get('tasks',value.id))throw Error('La clave ya existe; no se sobrescribió ninguna tarea');
 await put('tasks',value);const saved=await get('tasks',value.id);
 if(!saved||saved.workId!==workId||saved.title!==title||saved.dueDate!==dueDate||saved.dueTime!==dueTime||saved.status!==value.status||saved.createdAt!==value.createdAt||saved.updatedAt!==now)throw Error('No se pudo verificar la tarea guardada');
 return saved;
}
function journalTaskForm(item={}){
 if(!activeWork||!workChosen){toast('Primero selecciona una obra');return go('home')}
 const workId=activeWork,date=journalValidDay(item.dueDate)?item.dueDate:(journalDay||journalLocalDate());
 modal(item.id?'Editar o reprogramar tarea':'Nueva tarea pendiente',`<p class="subtle">${esc(workName(workId))}</p>${area('Descripción','title',item.title||'')}<div class="form-grid">${field('Fecha programada','dueDate',date,'date','required')}${field('Hora opcional','dueTime',item.dueTime||'','time')}</div>`,'Guardar tarea',async(f,form)=>{
  const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{const saved=await saveJournalTask(f,item.id||'',workId);if(page==='journal'&&activeWork===workId)journalDay=saved.dueDate;toast(item.id?'Tarea actualizada':'Tarea programada y verificada')}
  finally{button.disabled=false}
 });
 const description=$('#modal [name="title"]');description.required=true;description.maxLength=5000;
}
async function setJournalTaskStatus(id,workId,done){
 const task=await get('tasks',id);if(!task||task.workId!==workId||task.deletedAt)throw Error('La tarea no está disponible en esta obra');
 const now=new Date().toISOString(),value={...task,status:done?'terminado':'pendiente',completedAt:done?now:'',updatedAt:now};
 await put('tasks',value);const saved=await get('tasks',id);
 if(saved?.status!==value.status||saved?.completedAt!==value.completedAt||saved?.updatedAt!==now)throw Error('No se pudo verificar el estado guardado');
}

async function renderDailyJournal(view,current,tasks,activities){
 const selected=journalDay||journalLocalDate(),workId=activeWork; journalDay=selected;
 const notes=await journalNotes(workId);
 const entries=[...notes.map(item=>({type:'note',item})),...tasks.filter(t=>t.workId===workId).map(item=>({type:'task',item})),...activities.filter(a=>a.workId===workId).map(item=>({type:'activity',item}))]
  .map(e=>({...e,item:{...e.item,createdAt:e.item.createdAt||(e.type==='task'?e.item.updatedAt:e.type==='activity'&&e.item.date?`${e.item.date}T${e.item.time||'00:00'}`:'')}}))
  .filter(e=>(e.type==='task'&&journalValidDay(e.item.dueDate)?e.item.dueDate:journalEntryDay(e.item))===selected)
  .sort((a,b)=>(Date.parse(b.item.createdAt)||0)-(Date.parse(a.item.createdAt)||0)||String(a.item.id).localeCompare(String(b.item.id)));
 const entryHtml=entries.map((e,i)=>{
  const item=e.item,d=new Date(item.createdAt),valid=!Number.isNaN(d.getTime()),time=valid?d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}):'Hora no disponible';
  let body,label;
  if(e.type==='note'){
   label='Nota';const linked=item.linkedTaskId?tasks.find(t=>t.id===item.linkedTaskId&&t.workId===workId&&t.sourceNoteId===item.id):null;
   const taskChanged=linked&&journalLinkedTaskChanged(item,linked);
   body=`<p>${esc(item.text).replace(/\n/g,'<br>')}</p>${linked?`<p class="journal-auto-task">Tarea programada para ${esc(dateFmt(linked.dueDate))}${linked.status==='terminado'?' · Realizada':''}</p>`:item.linkedTaskId?'<p class="journal-auto-task">La tarea vinculada ya no está disponible.</p>':''}${taskChanged?`<div class="journal-schedule-warning" role="status"><p>La nota cambió respecto a esta tarea. La tarea no se modificó ni se creó otra.</p>${linked.status==='terminado'?'<p>La tarea ya está realizada; sus datos se conservaron.</p>':`<div class="row">${editBtn('journal-task',linked.id,'Editar / reprogramar tarea')}</div>`}</div>`:''}${item.schedulingWarning?`<p class="journal-schedule-warning" role="note">${esc(item.schedulingWarning)}</p>`:''}`;
  }
  else if(e.type==='task'){
   const done=item.status==='terminado';label=done?'Realizada':'Tarea pendiente';
   body=`<label class="journal-task-check ${done?'is-done':''}"><input type="checkbox" data-journal-task="${esc(item.id)}" ${done?'checked':''} aria-label="Marcar como ${done?'pendiente':'realizada'}: ${esc(item.title)}"><span>${esc(item.title).replace(/\n/g,'<br>')}</span></label><p class="journal-task-schedule">Programada: ${esc(dateFmt(item.dueDate))}${item.dueTime?' · '+esc(item.dueTime):''}</p>${item.description?`<p>${esc(item.description).replace(/\n/g,'<br>')}</p>`:''}${item.followup?`<p>${esc(item.followup).replace(/\n/g,'<br>')}</p>`:''}${!done?`<div class="row">${editBtn('journal-task',item.id,'Editar / reprogramar')}</div>`:''}`;
  }else{label='Actividad';body=card(item.title,`${dateFmt(item.date)} ${item.time||''} · ${item.location||'Sin ubicación'}`,'',editBtn('activity',item.id),(item.description||'')+(item.notes?' · '+item.notes:''))}
  return `<article class="journal-daily-entry" data-entry-id="${esc(item.id)}" data-entry-type="${e.type}"><span class="journal-entry-number" aria-label="Anotación ${i+1}">${String(i+1).padStart(2,'0')}</span><div class="journal-entry-main"><div class="journal-entry-meta"><span class="tag">${label}</span><div class="journal-entry-controls"><time datetime="${esc(item.createdAt)}" title="Registro real: ${esc(dateTimeFmt(item.createdAt))}">${esc(time)}</time>${e.type==='note'?`<button type="button" class="journal-note-menu" data-action="journal-note-menu" data-id="${esc(item.id)}" aria-label="Opciones de la anotación" title="Opciones">⋯</button>`:''}</div></div>${valid&&journalLocalDate(item.createdAt)!==selected?`<p class="journal-real-date">Creada el ${esc(dateFmt(journalLocalDate(item.createdAt)))}</p>`:''}<div class="journal-entry-writing">${body}</div></div></article>`;
 }).join('');
 view.innerHTML=`<div class="section-head journal-heading"><div><div class="eyebrow">Mi libreta</div><h2>${esc(current?.name||'Obra')}</h2></div><button class="btn light small" data-action="back-menu">Volver al menú</button></div>
 <div class="journal-calendar"><div class="journal-calendar-date"><time datetime="${selected}">${esc(journalLongDate(selected))}</time><button class="btn light small" data-action="journal-today">Hoy</button></div><nav class="journal-day-navigation" aria-label="Cambiar fecha de la libreta"><button class="text-btn" data-action="journal-previous" aria-label="Día anterior">‹ Día anterior</button><button class="text-btn" data-action="journal-next" aria-label="Día siguiente">Día siguiente ›</button></nav></div>
 <div class="journal-add-actions"><button class="btn note-new" data-action="new-note">＋ Nueva anotación</button><button class="text-btn" data-action="journal-manual-task">Crear tarea manualmente</button></div>
 <section class="journal-paper" aria-label="Anotaciones del ${esc(journalLongDate(selected))}">${entryHtml||`<div class="journal-blank"><div><h3>Tu página está en blanco</h3><p>Anota aquí lo que quieras recordar para este día.</p><button class="btn" data-action="new-note">Comenzar a escribir</button></div></div>`}${entries.length?'<div class="journal-page-tail" aria-hidden="true"></div>':''}</section>`;
 view.querySelectorAll('.journal-daily-entry[data-entry-type="note"]').forEach(entry=>{
  let timer=0,origin=null,openedByHold=false;
  const stop=()=>{if(timer){clearTimeout(timer);timer=0}origin=null};
  entry.addEventListener('pointerdown',event=>{
   if(event.target.closest('button,a,input,textarea,select')||(event.pointerType==='mouse'&&event.button!==0))return;
   origin=[event.clientX,event.clientY];const id=entry.dataset.entryId;
   timer=setTimeout(()=>{timer=0;openedByHold=true;setTimeout(()=>{openedByHold=false},1200);openJournalNoteMenu(id)},560);
  });
  entry.addEventListener('pointermove',event=>{if(origin&&Math.hypot(event.clientX-origin[0],event.clientY-origin[1])>12)stop()});
  entry.addEventListener('pointerup',()=>{stop();if(openedByHold)setTimeout(()=>{openedByHold=false},700)});
  entry.addEventListener('pointercancel',stop);
  entry.addEventListener('pointerleave',stop);
  entry.addEventListener('contextmenu',event=>{event.preventDefault();stop();if(!openedByHold){openedByHold=true;setTimeout(()=>{openedByHold=false},1200);openJournalNoteMenu(entry.dataset.entryId)}});
 });
 view.querySelectorAll('[data-journal-task]').forEach(checkbox=>checkbox.onchange=async()=>{
  const done=checkbox.checked;checkbox.disabled=true;
  try{await setJournalTaskStatus(checkbox.dataset.journalTask,workId,done);if(page==='journal'&&activeWork===workId)await render();toast(done?'Tarea realizada':'Tarea pendiente')}
  catch(error){checkbox.checked=!done;toast('No se pudo guardar: '+error.message)}
  finally{checkbox.disabled=false}
 });
}
async function materialsForWork(workId){return (await all('settings')).filter(x=>typeof x.id==='string'&&x.id.startsWith(MATERIAL_PREFIX)&&x.value?.kind==='field-material'&&x.value.workId===workId).map(x=>x.value).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))}
function materialRecordDay(material){return journalValidDay(material.materialDate)?material.materialDate:journalLocalDate(material.createdAt)}
async function saveMaterial(f,materialDate=materialsDay||journalLocalDate(),workId=activeWork,id=uid(),editing=false){
 const material=String(f.material||'').trim(),quantity=Number(f.quantity),unit=String(f.unit||'').trim(),observation=String(f.observation||'').trim();
 if(!material||!unit||!Number.isFinite(quantity)||quantity<=0)throw Error('Revisa material, cantidad y unidad');
 if(!journalValidDay(materialDate))throw Error('La fecha del registro no es válida');
 const key=MATERIAL_PREFIX+id,existing=await get('settings',key),now=new Date().toISOString();
 if(editing&&(!existing||existing.value?.kind!=='field-material'||existing.value.id!==id||existing.value.workId!==workId))throw Error('El material no está disponible en esta obra');
 if(!editing&&existing){if(existing.value?.kind==='field-material'&&existing.value.id===id&&existing.value.workId===workId&&existing.value.material===material&&existing.value.quantity===quantity&&existing.value.unit===unit&&existing.value.observation===observation&&existing.value.materialDate===materialDate)return existing.value;throw Error('La clave del material ya existe; no se modificó ningún dato')}
 const value=editing?{...existing.value,material,quantity,unit,observation,materialDate,updatedAt:now}:{kind:'field-material',id,workId,material,quantity,unit,observation,materialDate,createdAt:now},row={...existing,id:key,value};
 await new Promise((resolve,reject)=>{const transaction=db.transaction('settings','readwrite');transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error||Error('No se pudo guardar el material'));transaction.onerror=()=>{};const store=transaction.objectStore('settings');if(editing)store.put(row);else store.add(row)});
 const saved=await get('settings',key);
 if(!saved||saved.id!==row.id||saved.value?.id!==id||saved.value?.kind!=='field-material'||saved.value?.workId!==workId||saved.value?.material!==material||saved.value?.quantity!==quantity||saved.value?.unit!==unit||saved.value?.observation!==observation||saved.value?.materialDate!==materialDate||saved.value?.createdAt!==value.createdAt)throw Error('No se pudo verificar el material guardado');
 return saved.value;
}
function materialForm(item={}){
 if(!activeWork||!workChosen){toast('Primero selecciona una obra');return go('home')}
 if(item.id&&item.workId!==activeWork){toast('El material no pertenece a esta obra');return}
 const workId=activeWork,editing=!!item.id,date=editing?materialRecordDay(item):page==='materials'?(materialsDay||journalLocalDate()):journalLocalDate(),draftId=item.id||uid();
 modal(editing?'Editar material':'Registrar material',`<p class="subtle">${esc(workName(workId))}<br>${editing?'Capturado el '+esc(dateTimeFmt(item.createdAt)):'Registro del '+esc(journalLongDate(date))+'. La fecha y hora reales de captura se conservan por separado.'}</p>${field('Material','material',item.material||'','text','required placeholder="Ej. cemento"')}${field('Cantidad','quantity',item.quantity??'','number','required min="0.001" step="any" placeholder="Ej. 4"')}${field('Unidad','unit',item.unit||'','text','required placeholder="Ej. bultos, piezas, metros, m³, litros o viajes"')}${area('Observación opcional','observation',item.observation||'')}${editing?field('Fecha del registro','materialDate',date,'date','required'):''}`,editing?'Guardar cambios':'Guardar material',async(f,form)=>{
  const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{const saved=await saveMaterial(f,editing?f.materialDate:date,workId,draftId,editing);if(page==='materials'&&activeWork===workId)materialsDay=materialRecordDay(saved);toast(editing?'Material actualizado y verificado':'Material guardado y verificado')}
  finally{button.disabled=false}
 });
}
async function renderDailyMaterials(view){
 const workId=activeWork,date=materialsDay||journalLocalDate();materialsDay=date;
 const list=(await materialsForWork(workId)).filter(material=>materialRecordDay(material)===date);
 view.innerHTML=`<div class="section-head materials-heading"><div><div class="eyebrow">Materiales</div><h2>${esc(workName(workId))}</h2></div><button class="btn light small" data-action="back-menu">Volver al menú</button></div>
 <div class="materials-calendar"><div class="materials-calendar-date"><time datetime="${date}">${esc(journalLongDate(date))}</time><button class="btn light small" data-action="materials-today">Hoy</button></div><nav class="materials-day-navigation" aria-label="Cambiar fecha de materiales"><button class="text-btn" data-action="materials-previous" aria-label="Día anterior">‹ Día anterior</button><button class="text-btn" data-action="materials-next" aria-label="Día siguiente">Día siguiente ›</button></nav></div>
 <button class="btn materials-register" data-action="new-material">＋ Registrar material</button>
 <div class="materials-table-wrap"><table class="materials-table"><caption>Materiales registrados en este día</caption><thead><tr><th scope="col">Material</th><th scope="col">Cantidad</th><th scope="col">Unidad</th></tr></thead><tbody>${list.map(m=>`<tr data-material-id="${esc(m.id)}"><th scope="row"><span class="materials-name">${esc(m.material)}</span>${m.observation?`<details class="materials-observation"><summary>Ver observación</summary><p>${esc(m.observation).replace(/\n/g,'<br>')}</p></details>`:''}</th><td class="materials-quantity">${esc(m.quantity)}</td><td><div class="materials-unit-actions"><span>${esc(m.unit)}</span><button class="btn light small material-edit" data-action="edit-material" data-id="${esc(m.id)}" aria-label="Editar ${esc(m.material)}">Editar</button></div></td></tr>`).join('')||'<tr><td class="materials-empty" colspan="3"><strong>Sin materiales para este día</strong><p>Registra aquí lo utilizado en esta fecha.</p></td></tr>'}</tbody></table></div>`;
}
function taskForm(item={}){if(!window._works.length){toast('Primero crea una obra');return}modal(item.id?'Editar pendiente':'Nuevo pendiente',select('Obra','workId',workOptions(),item.workId||activeWork)+field('Título','title',item.title||'','text','required')+area('Descripción','description',item.description||'')+`<div class="form-grid">${field('Fecha límite','dueDate',item.dueDate||today(),'date')}${select('Prioridad','priority',[['baja','Baja'],['media','Media'],['alta','Alta']],item.priority||'media')}</div>${select('Estado','status',[['pendiente','Pendiente'],['proceso','En proceso'],['terminado','Terminado']],item.status||'pendiente')}${area('Observaciones de seguimiento','followup',item.followup||'')}`,item.id?'Guardar cambios':'Guardar pendiente',async f=>{await put('tasks',{...item,...f,id:item.id||uid(),createdAt:item.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()});toast('Pendiente guardado')})}
function activityForm(item={}){if(!window._works.length){toast('Primero crea una obra');return}let workers=(window._workers||[]).filter(w=>!w.attendanceInactive||(item.workerIds||[]).includes(w.id));modal(item.id?'Editar actividad':'Registrar actividad',select('Obra','workId',workOptions(),item.workId||activeWork)+field('Actividad ejecutada','title',item.title||'','text','required')+`<div class="form-grid">${field('Fecha','date',item.date||today(),'date','required')}${field('Hora','time',item.time||new Date().toTimeString().slice(0,5),'time')}</div>`+field('Ubicación específica','location',item.location||'')+area('Trabajos realizados','description',item.description||'')+area('Observaciones, problemas y acciones pendientes','notes',item.notes||'')+`<div class="field"><label>Personal participante (selección múltiple)</label><select name="workerIds" multiple size="4">${workers.map(w=>`<option value="${w.id}" ${(item.workerIds||[]).includes(w.id)?'selected':''}>${esc(w.name)} · ${esc(w.trade)}</option>`).join('')}</select></div><div class="field"><label>Fotografías (se comprimen para ahorrar espacio)</label><input name="images" type="file" accept="image/*" capture="environment" multiple><small class="subtle">Las nuevas fotos se anexan; las existentes no se reemplazan.</small></div>`,item.id?'Guardar cambios':'Guardar actividad',async(f,form)=>{let ids=Array.from(form.elements.workerIds.selectedOptions).map(o=>o.value),a={...item,...f,workerIds:ids,images:undefined,id:item.id||uid(),createdAt:item.createdAt||new Date().toISOString()};delete a.images;await put('activities',a);for(const file of form.elements.images.files){let blob=await compressImage(file);await put('photos',{id:uid(),workId:a.workId,activityId:a.id,date:a.date,description:'',blob,type:blob.type,createdAt:new Date().toISOString()})}toast('Actividad guardada')})}
async function attendanceCrews(workId){return (await all('settings')).filter(r=>typeof r.id==='string'&&r.id.startsWith(ATTENDANCE_CREW_PREFIX)&&r.value?.kind==='attendance-crew'&&r.value.workId===workId).map(r=>r.value).sort((a,b)=>a.name.localeCompare(b.name,'es'))}
async function attendanceCrewOptions(workId,selected=''){
 const groups=await attendanceCrews(workId);
 return `<option value="" ${selected===''?'selected':''}>Sin cuadrilla</option>${groups.map(g=>`<option value="${esc(g.id)}" ${selected===g.id?'selected':''}>${esc(g.name)}</option>`).join('')}`;
}
function attendanceCrewId(worker){return typeof worker?.attendanceCrewId==='string'?worker.attendanceCrewId:''}
function attendanceTradeRank(trade){
 const normalized=String(trade||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').replace(/[^a-z0-9]+/g,' ').trim();
 if(/\b(encargad[oa]s?|cabos?)\b/.test(normalized))return 0;
 // Evaluar el cargo intermedio antes de «oficial» para evitar clasificarlo como oficial.
 if(/\bmedios?\s+oficial(?:es)?\b/.test(normalized))return 2;
 if(/\boficial(?:es)?\b/.test(normalized))return 1;
 if(/\bayudantes?\b/.test(normalized))return 3;
 return 4;
}
function attendanceWorkersForCrew(workers,crewId,marks=[]){return [...workers].filter(w=>attendanceCrewId(w)===crewId&&(!w.attendanceInactive||marks.some(r=>r.workerId===w.id))).sort((a,b)=>attendanceTradeRank(a.trade)-attendanceTradeRank(b.trade)||String(a.name||'').localeCompare(String(b.name||''),'es',{sensitivity:'base'})||String(a.id).localeCompare(String(b.id)))}
async function saveWorkerRecord(item,formValues,forAttendance=false,attendanceWorkId=activeWork){
 const name=String(formValues.name||'').trim(),trade=String(formValues.trade||'').trim(),assignment=formValues.attendanceCrewId||'';if(!name||!trade)throw Error('Escribe el nombre y el cargo');
 const selectedWork=forAttendance?attendanceWorkId:formValues.workId,current=item.id?await get('workers',item.id):{};
 if(item.id&&!current)throw Error('El trabajador ya no está disponible');
 if(assignment&&!(await attendanceCrews(selectedWork)).some(g=>g.id===assignment))throw Error('La cuadrilla no pertenece a esta obra');
 const saved={...current,...formValues,name,trade,workId:selectedWork,attendanceCrewId:assignment,id:item.id||uid(),createdAt:current.createdAt||new Date().toISOString()};
 await put('workers',saved);return saved;
}
async function workerForm(item={},forAttendance=false){
 if(!window._works.length){toast('Primero crea una obra');return}
 const workId=forAttendance?activeWork:(item.workId||activeWork);
 const crewField=`<div class="field"><label for="f-attendanceCrewId">Cuadrilla</label><select id="f-attendanceCrewId" name="attendanceCrewId">${await attendanceCrewOptions(workId,attendanceCrewId(item))}</select></div>`;
 modal(item.id?'Editar trabajador':'Agregar trabajador',
  (forAttendance?`<p class="subtle">${esc(workName(workId))}</p>`:select('Obra','workId',workOptions(),workId))+
  field('Nombre completo','name',item.name||'','text','required')+
  field('Cargo','trade',item.trade||'','text','required placeholder="Ej. Oficial, Ayudante, Residente, Operador"')+
  crewField+(forAttendance?'':area('Observaciones','notes',item.notes||'')),item.id?'Guardar cambios':'Guardar trabajador',async f=>{
   await saveWorkerRecord(item,f,forAttendance,workId);toast('Personal guardado');
  });
 if(!forAttendance){const workSelect=$('#modal select[name="workId"]'),crewSelect=$('#modal select[name="attendanceCrewId"]');if(workSelect)workSelect.onchange=async()=>{crewSelect.innerHTML=await attendanceCrewOptions(workSelect.value,'');}}
}

// Fechas de calendario locales: evita desplazar las asistencias de día por la zona horaria.
function attendanceDate(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function attendanceDay(date,offset){const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+offset);return attendanceDate(d)}
function attendanceSunday(date=attendanceDate()){const d=new Date(`${date}T12:00:00`);return attendanceDay(date,-d.getDay())}
function attendanceKey(workId,workerId,date){return ATTENDANCE_PREFIX+[workId,workerId,date].map(encodeURIComponent).join(':')}
async function attendanceForWork(workId){return (await all('settings')).filter(r=>typeof r.id==='string'&&r.id.startsWith(ATTENDANCE_PREFIX)&&r.value?.kind==='field-attendance'&&r.value.workId===workId).map(r=>r.value)}
function attendanceSymbol(status){return status==='present'?'✓':status==='absent'?'X':''}
function attendanceLabel(status){return status==='present'?'Asistencia':status==='absent'?'Falta':'Sin registrar'}
function attendanceTotal(marks){return marks.filter(m=>m.status==='present').length}
async function saveAttendance(workId,worker,date,status){
 if(!['','present','absent'].includes(status)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||attendanceDay(date,0)!==date)throw Error('Asistencia o fecha inválida');
 const id=attendanceKey(workId,worker.id,date),previous=await get('settings',id);
 if(previous&&(previous.value?.kind!=='field-attendance'||previous.value.workId!==workId||previous.value.workerId!==worker.id||previous.value.date!==date))throw Error('La clave pertenece a otro registro');
 const current=await get('workers',worker.id);
 if(current?.workId!==workId&&!(await attendanceForWork(workId)).some(r=>r.workerId===worker.id))throw Error('El trabajador no pertenece a esta obra');
 const now=new Date().toISOString(),value={...previous?.value,kind:'field-attendance',id,workId,workerId:worker.id,date,status,workerName:worker.name,workerTrade:worker.trade,createdAt:previous?.value?.createdAt||now,updatedAt:now};
 await put('settings',{id,value});
 const saved=await get('settings',id);
 if(saved?.value?.workId!==workId||saved.value?.workerId!==worker.id||saved.value?.date!==date||saved.value?.status!==status||saved.value?.updatedAt!==now)throw Error('No se pudo verificar la asistencia guardada');
 return saved.value;
}
async function retireWorker(id,restore=false){
 const worker=await get('workers',id);if(!worker)throw Error('Trabajador no encontrado');
 if(!restore&&!confirm(`¿Retirar a ${worker.name} de la lista activa? Su historial se conserva.`))return;
 const updated={...worker,attendanceInactive:!restore,attendanceRetiredAt:restore?'':new Date().toISOString()};
 await put('workers',updated);const saved=await get('workers',id);
 if(saved?.attendanceInactive!==!restore)throw Error('No se pudo verificar el cambio');
 toast(restore?'Trabajador reincorporado':'Trabajador retirado; historial conservado');await render();
}
async function renderAttendance(view){
 const workId=activeWork,start=attendanceWeek||attendanceSunday(),days=Array.from({length:7},(_,i)=>attendanceDay(start,i)),end=days[6];
 attendanceWeek=start;
 const marks=(await attendanceForWork(workId)).filter(r=>r.date>=start&&r.date<=end);
 const groups=await attendanceCrews(workId);if(attendanceCrewSelection&& !groups.some(g=>g.id===attendanceCrewSelection))attendanceCrewSelection='';
 const workers=window._workers.filter(w=>w.workId===workId),byWorker=new Map(workers.map(w=>[w.id,w]));
 // Las copias de nombre/cargo permiten consultar marcas incluso si se movió un trabajador a otra obra.
 for(const mark of marks)if(!byWorker.has(mark.workerId))byWorker.set(mark.workerId,{id:mark.workerId,name:mark.workerName||'Trabajador anterior',trade:mark.workerTrade||'',attendanceInactive:true,attendanceHistoryOnly:true});
 const inSelectedCrew=w=>attendanceCrewId(w)===attendanceCrewSelection;
 const list=attendanceWorkersForCrew([...byWorker.values()],attendanceCrewSelection,marks);
 const retired=workers.filter(w=>w.attendanceInactive&&inSelectedCrew(w)),dayNames=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
 view.innerHTML=`<div class="section-head"><div><h2>Pase de lista</h2><p class="subtle">${esc(workName(workId))}</p></div><button class="btn light small" data-action="back-menu">Menú de obra</button></div>
  <div class="attendance-crew-picker"><div class="field"><label for="attendanceCrewSelect">Cuadrilla para pase de lista</label><select id="attendanceCrewSelect"><option value="" ${attendanceCrewSelection===''?'selected':''}>Sin cuadrilla</option>${groups.map(g=>`<option value="${esc(g.id)}" ${attendanceCrewSelection===g.id?'selected':''}>${esc(g.name)}</option>`).join('')}</select></div><button class="btn light small" data-action="create-attendance-crew">＋ Cuadrilla</button></div>
  <div class="attendance-week row"><button class="btn light small" data-action="attendance-previous" aria-label="Semana anterior">‹ Anterior</button><strong>${dateFmt(start)} — ${dateFmt(end)}</strong><button class="btn light small" data-action="attendance-next" aria-label="Semana siguiente">Siguiente ›</button><button class="text-btn" data-action="attendance-current">Esta semana</button></div>
  <div class="toolbar"><button class="btn" data-action="attendance-new-worker">＋ Agregar trabajador</button><span class="subtle" id="attendance-save" role="status">Guardado automático</span></div>
  <p class="subtle">Toca cada día: vacío → ✓ asistencia → X falta → vacío. T cuenta solo ✓. Desliza la tabla para ver los siete días.</p>
  ${list.length?`<div class="attendance-scroll" role="region" aria-label="Asistencias semanales; desplaza horizontalmente" tabindex="0"><table class="attendance-table"><caption class="subtle">${attendanceCrewSelection?esc(groups.find(g=>g.id===attendanceCrewSelection)?.name||'Cuadrilla'):'Sin cuadrilla'} · Domingo a sábado · ${esc(workName(workId))}</caption><thead><tr><th scope="col">Nombre completo</th><th scope="col">Cargo</th>${days.map((d,i)=>`<th scope="col" title="${dayNames[i]} ${dateFmt(d)}"><span>${['D','L','M','M','J','V','S'][i]}</span><small>${d.slice(8)}/${d.slice(5,7)}</small></th>`).join('')}<th scope="col" title="Total de asistencias">T</th></tr></thead><tbody>${list.map((w,workerIndex)=>{
   const wm=marks.filter(m=>m.workerId===w.id);
   return `<tr><th scope="row"><span class="attendance-worker-number">${workerIndex+1}.</span><span>${esc(w.name)}</span>${w.attendanceInactive?'<small class="subtle">Retirado · historial</small>':''}${!w.attendanceHistoryOnly?`<div class="row">${editBtn('attendance-worker',w.id)}${!w.attendanceInactive?editBtn('retire-worker',w.id,'Retirar'):''}</div>`:''}</th><td>${esc(w.trade)}</td>${days.map(d=>{const status=wm.find(m=>m.date===d)?.status||'';return `<td><button type="button" class="attendance-cell ${status}" data-attendance="${esc(w.id)}" data-date="${d}" data-status="${status}" aria-label="${esc(w.name)} · ${dateFmt(d)} · ${attendanceLabel(status)}">${attendanceSymbol(status)}</button>`}).join('')}<td class="attendance-total">${attendanceTotal(wm)}</td></tr>`;
  }).join('')}</tbody></table></div>`:empty('Sin trabajadores en la lista activa','Agrega un trabajador o reincorpora uno retirado.')}
  ${retired.length?`<details class="panel attendance-retired"><summary>Trabajadores retirados (${retired.length})</summary><p class="subtle">Las semanas con registros conservan sus filas y permiten corregirlas.</p><div class="stack">${retired.map(w=>card(w.name,w.trade,'',editBtn('restore-worker',w.id,'Reincorporar'))).join('')}</div></details>`:''}`;
 const crewSelector=view.querySelector('#attendanceCrewSelect');crewSelector.onchange=()=>{attendanceCrewSelection=crewSelector.value;render()};
 const failedCells=new Set();
 view.querySelectorAll('[data-attendance]').forEach(button=>button.onclick=async()=>{
  const worker=byWorker.get(button.dataset.attendance),date=button.dataset.date,status=button.dataset.status,next=status===''?'present':status==='present'?'absent':'';
  button.disabled=true;attendancePending++;const message=view.querySelector('#attendance-save');if(message)message.textContent='Guardando…';
  try{
   await saveAttendance(workId,worker,date,next);
   button.dataset.status=next;button.textContent=attendanceSymbol(next);button.className=`attendance-cell ${next}`;button.setAttribute('aria-label',`${worker.name} · ${dateFmt(date)} · ${attendanceLabel(next)}`);
   const row=button.closest('tr');row.querySelector('.attendance-total').textContent=row.querySelectorAll('[data-status="present"]').length;
   failedCells.delete(button);
  }catch(error){failedCells.add(button);console.error(error);toast('No se pudo guardar: '+error.message)}
  finally{attendancePending--;button.disabled=false;if(message)message.textContent=attendancePending?'Guardando…':failedCells.size?'Hay marcas sin guardar. Vuelve a tocar las casillas que intentaste cambiar.':'Guardado'}
 });
}
function crewForm(){if(!window._works.length){toast('Primero crea una obra');return}modal('Registrar cuadrilla',select('Obra','workId',workOptions())+field('Fecha','date',today(),'date','required')+`<div class="form-grid">${['albañil','ayudante','operador','electricista','plomero','oficial','otro'].map((x,i)=>field(x[0].toUpperCase()+x.slice(1),'qty_'+x,'0','number','min="0"')).join('')}</div>`+area('Observaciones','notes'), 'Guardar cuadrilla',async f=>{let counts={};for(let k in f)if(k.startsWith('qty_')&&+f[k]>0)counts[k.slice(4)]=+f[k];await put('crews',{id:uid(),workId:f.workId,date:f.date,counts,notes:f.notes,createdAt:new Date().toISOString()});toast('Cuadrilla guardada')})}
async function attendanceCrewForm(){
 const workId=activeWork;if(!workId){toast('Selecciona una obra primero');return}
 modal('Crear cuadrilla para asistencia',`<p class="subtle">${esc(workName(workId))}</p>${field('Nombre de la cuadrilla','name','','text','required maxlength="50" placeholder="Ej. Cuadrilla 1"')}`,'Crear cuadrilla',async f=>{
  const name=f.name.trim();if(!name)throw Error('Escribe el nombre de la cuadrilla');
  if((await attendanceCrews(workId)).some(g=>g.name.toLocaleLowerCase('es')===name.toLocaleLowerCase('es')))throw Error('Ya existe una cuadrilla con ese nombre en esta obra');
  const id=uid(),value={kind:'attendance-crew',id,workId,name,createdAt:new Date().toISOString()};
  await put('settings',{id:ATTENDANCE_CREW_PREFIX+id,value});attendanceCrewSelection=id;toast('Cuadrilla creada; sus trabajadores siguen sin asignar hasta que los edites');
 });
}
async function fieldToolsForWork(workId){return (await all('settings')).filter(r=>typeof r.id==='string'&&r.id.startsWith(FIELD_TOOL_PREFIX)&&r.value?.kind==='physical-tool'&&r.value.workId===workId).map(r=>r.value)}
async function saveFieldTool(item,formValues,workId=activeWork){
 const name=String(formValues.name||'').trim(),quantity=Number(formValues.quantity),unit=String(formValues.unit||'pieza');
 const carriedDate=formValues.carriedDate,status=formValues.status==='returned'?'returned':'in-field',notes=String(formValues.notes||'').trim();
 if(!name||!Number.isInteger(quantity)||quantity<1)throw Error('Escribe el nombre y una cantidad entera de al menos 1');
 if(!journalValidDay(carriedDate))throw Error('Elige una fecha válida en que se llevó a la obra');
 let returnedDate='';if(status==='returned'){returnedDate=formValues.returnedDate||journalLocalDate();if(!journalValidDay(returnedDate))throw Error('Elige una fecha válida de devolución');if(returnedDate<carriedDate)throw Error('La devolución no puede ser anterior a la fecha en que se llevó')}
 const id=item.id||uid(),key=FIELD_TOOL_PREFIX+id,current=await get('settings',key);
 if(item.id&&(!current||current.value?.kind!=='physical-tool'||current.value.workId!==workId))throw Error('El registro de herramienta ya no está disponible para esta obra');
 if(!item.id&&current)throw Error('La clave ya existe; no se sobrescribió ningún registro');
 const now=new Date().toISOString(),value={...current?.value,...formValues,id,kind:'physical-tool',workId,name,quantity,unit,carriedDate,status,returnedDate,notes,createdAt:current?.value?.createdAt||now,updatedAt:now};
 await put('settings',{id:key,value});const saved=await get('settings',key);
 if(saved?.value?.id!==id||saved.value.workId!==workId||saved.value.name!==name||saved.value.quantity!==quantity||saved.value.status!==status||saved.value.returnedDate!==returnedDate||saved.value.createdAt!==value.createdAt||saved.value.updatedAt!==now)throw Error('No se pudo verificar el registro de herramienta');
 return saved.value;
}
function fieldToolForm(item={}){
 if(!activeWork||!workChosen){toast('Primero selecciona una obra');return go('home')}
 const returned=item.status==='returned',workId=item.workId||activeWork;
 modal(item.id?'Editar herramienta':'Agregar herramienta',`<p class="subtle">${esc(workName(workId))}</p>${field('Nombre de la herramienta','name',item.name||'','text','required maxlength="120" placeholder="Ej. Revolvedora"')}<div class="form-grid">${field('Cantidad','quantity',item.quantity||1,'number','min="1" step="1" required')}${select('Unidad','unit',[['pieza','Piezas'],['juego','Juegos'],['par','Pares'],['metro','Metros'],['otra','Otra']],item.unit||'pieza')}</div><div class="form-grid">${field('Fecha en que se llevó','carriedDate',item.carriedDate||journalLocalDate(),'date','required')}${select('Estado','status',[['in-field','En obra'],['returned','Devuelta']],returned?'returned':'in-field')}</div><div class="field field-tool-return-date ${returned?'':'hidden'}"><label for="f-returnedDate">Fecha de devolución</label><input id="f-returnedDate" name="returnedDate" type="date" value="${esc(item.returnedDate||journalLocalDate())}"></div>${area('Observaciones (opcional)','notes',item.notes||'')}`,'Guardar',async f=>{await saveFieldTool(item,f,workId);toast(item.id?'Herramienta actualizada':'Herramienta registrada')});
 const status=$('#modal select[name="status"]'),returnDate=$('#modal .field-tool-return-date');status.onchange=()=>{returnDate.classList.toggle('hidden',status.value!=='returned');const input=returnDate.querySelector('input');if(status.value==='returned'&&!input.value)input.value=journalLocalDate()};
}
async function returnFieldTool(id){const key=FIELD_TOOL_PREFIX+id,current=await get('settings',key);if(!current||current.value?.kind!=='physical-tool'||current.value.workId!==activeWork)throw Error('La herramienta ya no está disponible en esta obra');if(current.value.status==='returned')return;const now=new Date().toISOString(),returnedDate=journalLocalDate(),value={...current.value,status:'returned',returnedDate,updatedAt:now};if(returnedDate<value.carriedDate)throw Error('La fecha actual es anterior a la fecha de salida');await put('settings',{...current,value});const saved=await get('settings',key);if(saved?.value?.status!=='returned'||saved.value.returnedDate!==returnedDate||saved.value.id!==id)throw Error('No se pudo verificar la devolución');toast('Herramienta marcada como devuelta');await render()}
async function renderFieldTools(view){
 const list=await fieldToolsForWork(activeWork),active=list.filter(x=>x.status!=='returned').sort((a,b)=>String(b.carriedDate).localeCompare(String(a.carriedDate))||a.name.localeCompare(b.name,'es')),returned=list.filter(x=>x.status==='returned').sort((a,b)=>String(b.returnedDate).localeCompare(String(a.returnedDate))||a.name.localeCompare(b.name,'es'));
 const toolCard=x=>card(x.name,`${x.quantity} ${x.unit==='pieza'?'pieza(s)':x.unit==='juego'?'juego(s)':x.unit==='par'?'par(es)':x.unit==='metro'?'metro(s)':x.unit} · Llevada ${dateFmt(x.carriedDate)}`,x.status==='returned'?'Devuelta':'En obra',`${editBtn('edit-field-tool',x.id)}${x.status==='returned'?'':editBtn('return-field-tool',x.id,'Marcar devuelta')}`,`${x.status==='returned'&&x.returnedDate?`Devuelta ${dateFmt(x.returnedDate)}${x.notes?' · ':''}`:''}${x.notes||''}`);
 view.innerHTML=`<div class="section-head"><div><div class="eyebrow">${esc(workName(activeWork))}</div><h2>Herramientas de obra</h2></div><button class="btn light small" data-action="back-menu">Volver al menú</button></div><div class="toolbar"><button class="btn" data-action="new-field-tool">＋ Agregar herramienta</button></div><div class="section-head"><h3>En obra <span class="subtle">(${active.length})</span></h3></div><div class="stack">${active.map(toolCard).join('')||empty('No hay herramientas en obra','Lo que registres aparecerá en esta lista.')}</div><details class="panel field-tools-returned"><summary>Devueltas (${returned.length})</summary><div class="stack">${returned.map(toolCard).join('')||'<p class="subtle">Todavía no hay herramientas devueltas.</p>'}</div></details>`;
}
async function selectWork(){if(!window._works.length){workForm();return}modal('Seleccionar obra',select('Obra activa','workId',workOptions(),activeWork),'Usar esta obra',async f=>{workChosen=true;activeWork=f.workId;await put('settings',{id:'activeWork',value:activeWork});toast('Obra activa actualizada')})}
const card=(title,meta,tag='',actions='',desc='')=>`<article class="card"><div class="card-top"><div><h3>${esc(title)}</h3><p>${esc(meta)}</p></div>${tag?`<span class="tag ${tag.toLowerCase().replaceAll(' ','-')}">${esc(tag)}</span>`:''}</div>${desc?`<p>${esc(desc)}</p>`:''}${actions?`<div class="row" style="margin-top:10px">${actions}</div>`:''}</article>`;
function empty(title,desc,btn=''){return `<div class="empty"><b>${title}</b>${desc}${btn?`<div style="margin-top:13px">${btn}</div>`:''}</div>`}function editBtn(type,id,label='Editar'){return `<button class="btn light small" data-action="${type}" data-id="${id}">${label}</button>`}function eraseBtn(type,id){return `<button class="btn danger small" data-action="delete-${type}" data-id="${id}">Eliminar</button>`}
function updateNavigation(){
 const selected=workChosen&&window._works?.some(w=>w.id===activeWork),navPage=['home','works','workMenu'].includes(page)?'home':page;
 $('#active-label').textContent=selected?workName(activeWork):'Selecciona una obra';
 document.querySelectorAll('.tab').forEach(button=>{const active=button.dataset.page===navPage;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')});
 const toolsActive=['more','works','activities','agenda','personnel','export','settings'].includes(page);
 $('#toolsBtn').classList.toggle('active',toolsActive);
 if(toolsActive)$('#toolsBtn').setAttribute('aria-current','page');else $('#toolsBtn').removeAttribute('aria-current');
}
async function render(){try{window._works=await works();window._workers=await records('workers');let tasks=await records('tasks'),acts=await records('activities'),crew=await records('crews');if(!window._works.some(w=>w.id===activeWork)){workChosen=false;activeWork=window._works.find(w=>w.status==='activa')?.id||window._works[0]?.id||'';if(activeWork)await put('settings',{id:'activeWork',value:activeWork})}updateNavigation();let v=$('#view');v.dataset.page=page;let current=window._works.find(w=>w.id===activeWork),wTasks=tasks.filter(x=>x.workId===activeWork),wActs=acts.filter(x=>x.workId===activeWork),todayTasks=wTasks.filter(x=>x.status!=='terminado'&&x.dueDate===today()),overdue=wTasks.filter(x=>x.status!=='terminado'&&x.dueDate&&x.dueDate<today()),upcoming=wTasks.filter(x=>x.status!=='terminado'&&x.dueDate>today()).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
 if(page==='home'){v.innerHTML=`<div class="section-head"><h2>Mis obras</h2><button class="btn small" data-action="new-work">＋ Nueva obra</button></div><p class="subtle">Selecciona dónde vas a trabajar. Cada obra tiene su propia libreta de notas.</p><div class="stack">${window._works.map(w=>`<button class="work-choice" data-action="choose-work" data-id="${esc(w.id)}"><span><strong>${esc(w.name)}</strong>${w.location?`<small>${esc(w.location)}</small>`:''}</span><span aria-hidden="true">›</span></button>`).join('')||empty('Todavía no hay obras','Crea una obra para comenzar.','<button class="btn" data-action="new-work">Crear obra</button>')}</div>`}
 else if(page==='workMenu'){v.innerHTML=`<div class="section-head work-menu-head"><div><div class="eyebrow">Obra seleccionada</div><h2>${esc(current?.name||'Obra')}</h2>${current?.location?`<p class="subtle">${esc(current.location)}</p>`:''}</div><button class="btn light small" data-action="back-works">Mis obras</button></div><div class="work-menu-grid"><button class="work-menu-card" data-action="open-journal"><span class="menu-icon">✎</span><strong>Mi libreta</strong><small>Notas, pendientes y actividades</small></button><button class="work-menu-card" data-action="open-materials"><span class="menu-icon">▤</span><strong>Materiales</strong><small>Uso de materiales en campo</small></button><button class="work-menu-card" type="button" data-action="open-attendance"><span class="menu-icon">☷</span><strong>Pase de lista</strong><small>Asistencias de domingo a sábado</small></button><button class="work-menu-card" type="button" data-action="open-field-tools"><span class="menu-icon">⚒</span><strong>Herramientas de obra</strong><small>Equipo que llevas y devuelves</small></button></div><button class="btn note-new quick-note" data-action="new-note">＋ Anotar algo</button>`}else if(page==='journal'){await renderDailyJournal(v,current,tasks,acts)}
 else if(page==='works'){v.innerHTML=`<div class="section-head"><h2>Mis obras</h2><button class="btn small" data-action="new-work">＋ Nueva obra</button></div><div class="stack">${window._works.map(w=>card(w.name,`${w.location||'Ubicación sin especificar'} · Inició ${dateFmt(w.startDate)}${w.endDate?' · Término '+dateFmt(w.endDate):''}`,w.archived?'Archivada':w.status==='activa'?'Activa':'Terminada',`<button class="btn ${w.id===activeWork?'':'light'} small" data-action="activate" data-id="${w.id}">${w.id===activeWork?'Activa':'Hacer activa'}</button>${editBtn('work',w.id)}${editBtn(w.archived?'unarchive-work':'archive-work',w.id,w.archived?'Desarchivar':'Archivar')}${eraseBtn('work',w.id)}`,w.notes)).join('')||empty('Todavía no hay obras','Crea la primera para comenzar.','<button class="btn" data-action="new-work">Crear obra</button>')}</div>`}
 else if(page==='agenda'){let list=tasks.filter(t=>(filterWork==='all'||t.workId===filterWork)&&(!filterDate||t.dueDate===filterDate)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));v.innerHTML=`<div class="section-head"><div><h2>Agenda y pendientes</h2><span class="subtle">${esc(workName(activeWork))}</span></div><div class="row"><button class="btn light small" data-action="back-menu">Menú de obra</button><button class="btn small" data-action="new-task">＋ Pendiente</button></div></div><div class="form-grid"><div class="field"><label>Obra</label><select id="filterWork">${workOptions(filterWork,true).map(([x,l])=>`<option value="${x}" ${x===filterWork?'selected':''}>${esc(l)}</option>`).join('')}</select></div>${field('Filtrar por fecha límite','filterDate',filterDate,'date')}</div><div class="filter-row"><button data-status="all" class="selected">Todos</button><button data-status="open">Abiertos</button><button data-status="done">Terminados</button><button data-status="overdue">Vencidos</button></div><div class="stack">${list.map(t=>card(t.title,`${workName(t.workId)} · Límite ${dateFmt(t.dueDate)} · ${t.priority}`,t.status==='terminado'?'Terminado':t.dueDate<today()?'Vencido':t.dueDate===today()?'Hoy':t.status==='proceso'?'En proceso':'Pendiente',`${editBtn('task',t.id)}${t.status==='terminado'?editBtn('reopen-task',t.id,'Reabrir'):editBtn('complete-task',t.id,'Completar')}`,t.description+(t.followup?' · '+t.followup:''))).join('')||empty('Sin pendientes','No hay registros para estos filtros.')}</div>`;$('#filterWork').onchange=e=>{filterWork=e.target.value;render()};$('#f-filterDate').onchange=e=>{filterDate=e.target.value;render()};v.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>{v.querySelectorAll('[data-status]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');v.querySelectorAll('.card').forEach(c=>{let tag=c.querySelector('.tag')?.textContent||'',status=b.dataset.status;c.classList.toggle('hidden',status==='open'&&tag==='Terminado'||status==='done'&&tag!=='Terminado'||status==='overdue'&&tag!=='Vencido')})})}
 else if(page==='activities'){let list=acts.filter(a=>(filterWork==='all'||a.workId===filterWork)&&(!filterDate||a.date===filterDate)).sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time));v.innerHTML=`<div class="section-head"><h2>Actividades de campo</h2><button class="btn small" data-action="new-activity">＋ Registrar</button></div><div class="form-grid"><div class="field"><label>Obra</label><select id="filterWork">${workOptions(filterWork,true).map(([x,l])=>`<option value="${x}" ${x===filterWork?'selected':''}>${esc(l)}</option>`).join('')}</select></div>${field('Fecha','filterDate',filterDate,'date')}</div><div class="stack">${list.map(a=>card(a.title,`${workName(a.workId)} · ${dateFmt(a.date)} ${a.time||''} · ${a.location||'Sin ubicación'}`,'Ejecutada',`${editBtn('activity',a.id)}${a.workerIds?.length?`<span class="subtle">${a.workerIds.length} participantes</span>`:''}`,a.description+(a.notes?' · '+a.notes:''))).join('')||empty('Sin actividades','Registra lo ejecutado. Los pendientes se capturan en Agenda.')}</div>`;$('#filterWork').onchange=e=>{filterWork=e.target.value;render()};$('#f-filterDate').onchange=e=>{filterDate=e.target.value;render()}}
 else if(page==='more'){v.innerHTML=`<div class="section-head"><h2>Administración</h2></div><div class="more-grid"><button class="more-item" data-page="works"><b>Administrar obras</b><small>Editar y archivar obras</small></button><button class="more-item" data-page="activities"><b>Actividades de campo</b><small>Trabajos realizados y fotografías</small></button><button class="more-item" data-page="agenda"><b>Agenda y pendientes</b><small>Filtros y seguimiento existentes</small></button><button class="more-item" data-page="personnel"><b>Personal</b><small>Trabajadores y cuadrillas</small></button><button class="more-item" data-page="export"><b>Exportar y respaldar</b><small>Excel y copia de seguridad</small></button><button class="more-item" data-page="settings"><b>Ajustes</b><small>Almacenamiento y ayuda</small></button></div><div class="inline-note">Los registros y fotografías se guardan en este dispositivo. Puedes adjuntar fotos a una actividad de campo. Crea respaldos periódicos y copia el archivo fuera del teléfono.</div>`}
 else if(page==='attendance'){await renderAttendance(v)}
 else if(page==='field-tools'){await renderFieldTools(v)}
 else if(page==='personnel'){let crewList=crew.filter(c=>filterWork==='all'||c.workId===filterWork).sort((a,b)=>b.date.localeCompare(a.date));v.innerHTML=`<div class="section-head"><h2>Personal</h2><div class="row"><button class="btn light small" data-action="new-crew">＋ Cuadrilla</button><button class="btn small" data-action="new-worker">＋ Persona</button></div></div><div class="section-head"><h2>Trabajadores</h2></div><div class="stack">${window._workers.filter(w=>filterWork==='all'||w.workId===filterWork).map(w=>card(w.name,`${workName(w.workId)} · ${w.trade}`,w.attendanceInactive?'Retirado':w.trade,`${editBtn('worker',w.id)}${editBtn(w.attendanceInactive?'restore-worker':'retire-worker',w.id,w.attendanceInactive?'Reincorporar':'Retirar')}`,w.notes)).join('')||empty('Sin personal registrado','Agrega personas para reutilizarlas en actividades.')}</div><div class="section-head"><h2>Historial de cuadrillas</h2></div><div class="stack">${crewList.map(c=>card(dateFmt(c.date),workName(c.workId),'Cuadrilla','',Object.entries(c.counts).map(([k,n])=>`${k}: ${n}`).join(' · ')+(c.notes?' · '+c.notes:''))).join('')||empty('Sin cuadrillas','Guarda conteos diarios por oficio.')}</div>`}
 else if(page==='materials'){await renderDailyMaterials(v)}else if(page==='photos'){let ps=(await records('photos')).filter(p=>filterWork==='all'||p.workId===filterWork);v.innerHTML=`<div class="section-head"><h2>Fotografías</h2><button class="btn small" data-action="new-photo">＋ Agregar</button></div><div class="field"><label>Obra</label><select id="filterWork">${workOptions(filterWork,true).map(([x,l])=>`<option value="${x}" ${x===filterWork?'selected':''}>${esc(l)}</option>`).join('')}</select></div><div class="stack">${ps.length?ps.map(p=>`<article class="card"><div class="row" style="align-items:flex-start"><img src="${URL.createObjectURL(p.blob)}" alt="Fotografía de obra" style="width:112px;height:112px;object-fit:cover;border-radius:12px"><div style="flex:1"><h3>${esc(p.description||'Fotografía de obra')}</h3><p>${esc(workName(p.workId))} · ${dateFmt(p.date)}</p>${p.activityId?'<p>Vinculada a actividad</p>':''}${eraseBtn('photo',p.id)}</div></div></article>`).join(''):empty('Sin fotografías','Agrega evidencia visual; queda guardada en este dispositivo.')}</div>`;$('#filterWork').onchange=e=>{filterWork=e.target.value;render()}}
 else if(page==='export'){v.innerHTML=`<div class="section-head"><h2>Exportar y respaldar</h2></div><section class="panel"><h3>Exportar Excel (.xlsx)</h3><p class="subtle">Siete hojas: obras, actividades, pendientes, personal, materiales, Mi libreta y asistencia semanal. Fechas en DD/MM/AAAA y horas locales. El periodo filtra notas por página, tareas por fecha programada, actividades y materiales por fecha de trabajo. Asistencia incluye semanas completas que intersectan el periodo, incluso días fuera de sus límites; el total corresponde a la semana completa. Obras y trabajadores son datos de referencia sin filtro de fecha. Las fotos se indican como referencia; no se insertan en Excel.</p><form id="exportForm"><div class="field"><label>Obra</label><select name="workId">${workOptions(activeWork,true).map(([x,l])=>`<option value="${x}">${esc(l)}</option>`).join('')}</select></div><div class="form-grid">${field('Desde','from','','date')}${field('Hasta','to','','date')}</div><button class="btn" type="submit">Descargar Excel</button></form></section><section class="panel" style="margin-top:12px"><h3>Respaldo completo con fotografías</h3><p class="subtle">Genera un archivo ZIP local. Guarda una copia en una computadora o USB compatible; restaurar en otro dispositivo no transfiere automáticamente los datos.</p><div class="toolbar"><button class="btn" data-action="backup">Crear respaldo ZIP</button><label class="btn light" for="restoreFile">Restaurar respaldo</label><input id="restoreFile" class="hidden" type="file" accept=".zip,application/zip"></div><div class="inline-note">La restauración agrega datos; cuando hay identificadores repetidos conserva los datos existentes y omite esos registros. Valida el formato antes de importar.</div></section>`;$('#exportForm').onsubmit=async e=>{e.preventDefault();let f=Object.fromEntries(new FormData(e.currentTarget));try{await exportXlsx(f);toast('Excel descargado')}catch(err){console.error(err);toast('Falló la exportación: '+err.message)}};$('#restoreFile').onchange=async e=>{if(e.target.files[0]&&confirm('Se agregarán los registros e imágenes del respaldo. Los identificadores existentes se conservarán. ¿Continuar?'))try{await restoreBackup(e.target.files[0]);toast('Respaldo restaurado')}catch(err){console.error(err);toast('Respaldo inválido o incompleto: '+err.message)}e.target.value=''} }
 else if(page==='settings'){let estimate=await navigator.storage?.estimate?.().catch(()=>null);v.innerHTML=`<div class="section-head"><h2>Ajustes</h2></div><section class="panel"><h3>Almacenamiento local</h3><p>${estimate?`${(estimate.usage/1048576).toFixed(1)} MB usados de ${(estimate.quota/1048576).toFixed(0)} MB disponibles aprox.`:'El navegador no informa el espacio usado.'}</p><button class="btn light small" id="persistBtn">Solicitar almacenamiento persistente</button><p class="subtle">El navegador puede limitar o borrar datos locales si el dispositivo tiene poco espacio. No borres datos del navegador ni desinstales la PWA sin un respaldo reciente.</p><div class="divider"></div><h3>Uso y alcance</h3><p class="subtle">La información se guarda solo en este dispositivo. Usa el respaldo ZIP con regularidad y conserva copias fuera del teléfono. Esta app es una herramienta auxiliar de control y no es una bitácora oficial ni sustituye formatos exigidos por Obras Públicas.</p><button class="btn light small" data-action="select-work">Cambiar obra activa</button></section>`;$('#persistBtn').onclick=async()=>toast(await navigator.storage?.persist?.()?'Almacenamiento persistente concedido':'El navegador no concedió almacenamiento persistente')}
 $('#view').querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));$('#view').querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action,b.dataset.id));$('#quickBtn').classList.toggle('hidden',page==='export'||page==='settings'||page==='attendance'||page==='field-tools')
 }catch(e){console.error(e);$('#view').innerHTML=empty('No se pudo abrir la información','Recarga la aplicación y vuelve a intentar.');toast('Error al leer IndexedDB')}}
function go(p){
 if(attendancePending){toast('Espera a que se guarden las asistencias');return}
 if(['materials','journal','attendance'].includes(p)&&(!workChosen||!window._works?.some(w=>w.id===activeWork))){toast('Primero elige una obra');p='home'}
 if(p==='journal')journalDay=journalLocalDate();
 if(p==='materials')materialsDay=journalLocalDate();
 if(p==='attendance')attendanceWeek=attendanceSunday();
 page=p;render();
}async function action(a,id){try{
 if(attendancePending){toast('Espera a que se guarden las asistencias');return}
 if(['journal-previous','journal-next','journal-today'].includes(a)){
  if(page!=='journal')return;
  const day=a==='journal-today'?journalLocalDate():journalShiftDay(journalDay,a==='journal-previous'?-1:1);
  if(!journalValidDay(day)){toast('La fecha está fuera del rango disponible');return}
  journalDay=day;return render();
 }
 if(['materials-previous','materials-next','materials-today'].includes(a)){
  if(page!=='materials')return;
  const date=a==='materials-today'?journalLocalDate():journalShiftDay(materialsDay,a==='materials-previous'?-1:1);
  if(!journalValidDay(date)){toast('La fecha está fuera del rango disponible');return}
  materialsDay=date;return render();
 }
 if(a==='edit-material'){
  const row=await get('settings',MATERIAL_PREFIX+id);
  if(!row||row.value?.kind!=='field-material'||row.value.id!==id||row.value.workId!==activeWork)throw Error('El material no está disponible en esta obra');
  return materialForm(row.value);
 }
 if(a==='journal-manual-task')return journalTaskForm();
 if(a==='journal-task'){const task=await get('tasks',id);if(!task||task.workId!==activeWork)throw Error('La tarea no pertenece a esta obra');return journalTaskForm(task)}
 if(a==='journal-note-menu')return openJournalNoteMenu(id);
 if(a==='edit-journal-note'){const row=await get('settings',NOTE_PREFIX+id);if(!row||row.value?.kind!=='journal-note'||row.value.workId!==activeWork)throw Error('La anotación no está disponible en esta obra');return journalNoteEditForm(row.value)}
 if(a==='delete-journal-note'){
  const row=await get('settings',NOTE_PREFIX+id);if(!row||row.value?.kind!=='journal-note'||row.value.id!==id||row.value.workId!==activeWork)throw Error('La anotación no está disponible en esta obra');
  if(!await confirmAndDeleteJournalNote(row.value))return;
  $('#modal').classList.add('hidden');toast('Anotación eliminada');return render();
 }
 if(a==='open-field-tools'){if(!activeWork||!workChosen)return go('home');return go('field-tools')}
 if(a==='new-field-tool')return fieldToolForm();
 if(a==='edit-field-tool'){const row=await get('settings',FIELD_TOOL_PREFIX+id);if(!row||row.value?.kind!=='physical-tool'||row.value.id!==id||row.value.workId!==activeWork)throw Error('La herramienta no está disponible en esta obra');return fieldToolForm(row.value)}
 if(a==='return-field-tool')return returnFieldTool(id);
 if(a==='open-attendance'){if(!activeWork||!workChosen)return go('home');attendanceWeek=attendanceSunday();page='attendance';return render()}
 if(a==='attendance-previous'||a==='attendance-next'||a==='attendance-current'){attendanceWeek=a==='attendance-current'?attendanceSunday():attendanceDay(attendanceWeek,a==='attendance-previous'?-7:7);return render()}
 if(a==='create-attendance-crew')return attendanceCrewForm();
 if(a==='attendance-new-worker')return workerForm({},true);
 if(a==='attendance-worker')return workerForm(await get('workers',id),true);
 if(a==='retire-worker'||a==='delete-worker')return await retireWorker(id);
 if(a==='restore-worker')return await retireWorker(id,true);
 if(a==='choose-work'){workChosen=true;activeWork=id;await put('settings',{id:'activeWork',value:activeWork});page='workMenu';return render()}if(a==='back-works'){page='home';return render()}if(a==='open-agenda'){filterWork=activeWork;page='agenda';return render()}if(a==='open-materials')return go('materials');if(a==='open-journal')return go('journal');if(a==='back-menu'){page='workMenu';return render()}if(a==='new-note')return journalNoteForm();if(a==='new-material')return materialForm();if(a==='new-work')return workForm();if(a==='new-task')return taskForm();if(a==='new-activity')return activityForm();if(a==='new-worker')return workerForm();if(a==='new-crew')return crewForm();if(a==='select-work')return selectWork();if(a==='archive-work'||a==='unarchive-work'){let w=await get('works',id);w.archived=a==='archive-work';await put('works',w);toast(w.archived?'Obra archivada':'Obra desarchivada');return render()}let table=a.replace('delete-','');if(a.startsWith('delete-')){if(!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.'))return;if(table==='work'){for(const s of ['tasks','activities','workers','crews','photos'])for(const x of await all(s))if(x.workId===id)await del(s,x.id);await del('works',id);if(activeWork===id){activeWork='';await del('settings','activeWork')}}else await del(table==='photo'?'photos':table==='worker'?'workers':'tasks',id);toast('Registro eliminado');return render()}if(a==='activate'){workChosen=true;activeWork=id;await put('settings',{id:'activeWork',value:id});toast('Obra activa actualizada');return render()}if(a==='complete-task'||a==='reopen-task'){let t=await get('tasks',id);t.status=a==='complete-task'?'terminado':'pendiente';t.completedAt=a==='complete-task'?new Date().toISOString():'';await put('tasks',t);toast(a==='complete-task'?'Pendiente completado':'Pendiente reabierto');return render()}if(a==='task')return taskForm(await get('tasks',id));if(a==='activity')return activityForm(await get('activities',id));if(a==='worker')return workerForm(await get('workers',id));if(a==='work')return workForm(await get('works',id));if(a==='backup')return backup();if(a==='new-photo')return photoForm()}catch(e){console.error(e);toast('No se completó la acción: '+e.message)}}
function photoForm(){if(!window._works.length){toast('Primero crea una obra');return}modal('Agregar fotografías',select('Obra','workId',workOptions())+field('Fecha','date',today(),'date')+field('Descripción opcional','description')+'<div class="field"><label>Imágenes (cámara o galería)</label><input type="file" name="files" accept="image/*" capture="environment" multiple required></div>', 'Guardar fotos',async(f,form)=>{for(const file of form.elements.files.files){let blob=await compressImage(file);await put('photos',{id:uid(),workId:f.workId,date:f.date,description:f.description,blob,type:blob.type,createdAt:new Date().toISOString()})}toast('Fotografías guardadas')})}
async function compressImage(file){if(!file.type.startsWith('image/'))throw Error('El archivo no es una imagen');if(file.size<500000)return file;let bitmap=await createImageBitmap(file),scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);return await new Promise(res=>canvas.toBlob(res,'image/jpeg',.78))}
// ZIP sin compresión: suficiente para datos pequeños y universal, sin paquetes externos.
const crcTable=(()=>{let t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();function crc32(b){let c=0xffffffff;for(let x of b)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0}function le(n,len){let a=new Uint8Array(len);for(let i=0;i<len;i++)a[i]=(n>>>8*i)&255;return a}function join(arr){let n=arr.reduce((s,x)=>s+x.length,0),o=new Uint8Array(n),p=0;for(let x of arr){o.set(x,p);p+=x.length}return o}async function makeZip(entries){let enc=new TextEncoder(),locals=[],centrals=[],offset=0;for(let [name,value] of entries){let data=value instanceof Uint8Array?value:value instanceof Blob?new Uint8Array(await value.arrayBuffer()):enc.encode(String(value)),nm=enc.encode(name),crc=crc32(data),head=join([le(0x04034b50,4),le(20,2),le(0,2),le(0,2),le(0,2),le(0,2),le(crc,4),le(data.length,4),le(data.length,4),le(nm.length,2),le(0,2),nm]),local=join([head,data]);locals.push(local);centrals.push(join([le(0x02014b50,4),le(20,2),le(20,2),le(0,2),le(0,2),le(0,2),le(0,2),le(crc,4),le(data.length,4),le(data.length,4),le(nm.length,2),le(0,2),le(0,2),le(0,2),le(0,2),le(0,4),le(offset,4),nm]));offset+=local.length}let central=join(centrals),end=join([le(0x06054b50,4),le(0,2),le(0,2),le(entries.length,2),le(entries.length,2),le(central.length,4),le(offset,4),le(0,2)]);return new Blob([...locals,central,end],{type:'application/zip'})}
function download(blob,name){let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000)}
async function backup(){let entries=[],data={format:'agenda-obra-backup',version:1,createdAt:new Date().toISOString(),records:{}};for(let s of STORE){let rows=await all(s);if(s==='photos'){data.records.photos=rows.map((p,i)=>{let path=`photos/${p.id}.jpg`;entries.push([path,p.blob]);return {...p,blobPath:path,blob:undefined}})}else data.records[s]=rows}entries.unshift(['data.json',JSON.stringify(data)]);download(await makeZip(entries),`respaldo-agenda-obra-${today()}.zip`);toast('Respaldo ZIP creado')}
// ZIP reader accepts the uncompressed STORE archives generated by this application.
async function unzip(blob){let b=new Uint8Array(await blob.arrayBuffer()),v=new DataView(b.buffer),dec=new TextDecoder(),files={};let eocd=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){eocd=i;break}if(eocd<0)throw Error('No se encontró el índice ZIP');let count=v.getUint16(eocd+10,true),p=v.getUint32(eocd+16,true);for(let i=0;i<count;i++){if(v.getUint32(p,true)!==0x02014b50)throw Error('Índice ZIP incorrecto');let size=v.getUint32(p+24,true),expected=v.getUint32(p+16,true),nl=v.getUint16(p+28,true),el=v.getUint16(p+30,true),cl=v.getUint16(p+32,true),off=v.getUint32(p+42,true),name=dec.decode(b.slice(p+46,p+46+nl));if(v.getUint16(p+10,true)!==0)throw Error('ZIP comprimido no compatible');let lnl=v.getUint16(off+26,true),lel=v.getUint16(off+28,true),start=off+30+lnl+lel,data=b.slice(start,start+size);if(crc32(data)!==expected)throw Error('Datos dañados: '+name);files[name]=data;p+=46+nl+el+cl}return files}
async function restoreBackup(blob){if(blob.size>250*1024*1024)throw Error('Archivo mayor a 250 MB');let files=await unzip(blob),bytes=files['data.json'];if(!bytes)throw Error('Falta data.json');let data=JSON.parse(new TextDecoder().decode(bytes));if(data.format!=='agenda-obra-backup'||data.version!==1||!data.records)throw Error('Formato de respaldo no reconocido');for(let s of STORE){if(!Array.isArray(data.records[s]))throw Error('Faltan datos de '+s);for(let row of data.records[s]){if(!row?.id)throw Error('Registro sin identificador');if(await get(s,row.id))continue;if(s==='photos'){let payload=files[row.blobPath];if(!payload)throw Error('Falta imagen en respaldo');row.blob=new Blob([payload],{type:row.type||'image/jpeg'});delete row.blobPath}await put(s,row)}}await render()}
const col=n=>{let s='';while(n){let r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26)}return s};
// Solo el exportador limpia caracteres no permitidos por XML 1.0; no altera los datos.
function xml(s){return esc(String(s??'').replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,''))}
function sheet(rows){
 const widths=rows[0].map((_,j)=>Math.min(56,Math.max(12,...rows.slice(0,201).map(r=>Math.max(...String(r[j]??'').split('\n').map(t=>Array.from(t).length))+2))));
 const body=rows.map((r,i)=>'<row r="'+(i+1)+'"'+(i===0?' ht="32" customHeight="1"':'')+'>'+r.map((x,j)=>{const ref=col(j+1)+(i+1),style=i===0?1:0;return typeof x==='number'&&Number.isFinite(x)?'<c r="'+ref+'" s="'+style+'"><v>'+x+'</v></c>':'<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(x)+'</t></is></c>'}).join('')+'</row>').join('');
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')+'</cols><sheetData>'+body+'</sheetData><autoFilter ref="A1:'+col(rows[0]?.length||1)+rows.length+'"/></worksheet>';
}
function exportDate(day){return journalValidDay(day)?day.slice(8)+'/'+day.slice(5,7)+'/'+day.slice(0,4):''}
function exportTime(value){const d=new Date(value);return Number.isNaN(d.getTime())?'':String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
function exportStamp(value){if(!value)return '';const day=journalLocalDate(value);return day?exportDate(day)+' '+exportTime(value):''}
async function exportXlsx(f){
 const from=f.from||'0001-01-01',to=f.to||'9999-12-31',wid=f.workId;
 if(!journalValidDay(from)||!journalValidDay(to)||from>to)throw Error('Revisa el periodo: Desde debe ser anterior o igual a Hasta');
 const [allWorks,allTasks,allActs,allWorkers,allCrews,allPhotos,settings]=await Promise.all([works(),records('tasks'),records('activities'),records('workers'),records('crews'),records('photos'),all('settings')]);
 const attendanceCrewNames=new Map(settings.filter(r=>typeof r.id==='string'&&r.id.startsWith(ATTENDANCE_CREW_PREFIX)&&r.value?.kind==='attendance-crew').map(r=>[r.value.id,r.value.name]));
 const matches=x=>wid==='all'||x.workId===wid,inRange=d=>journalValidDay(d)&&d>=from&&d<=to;
 const name=id=>allWorks.find(w=>w.id===id)?.name||'Obra no disponible ('+id+')';
 const order=(date)=> (a,b)=>name(a.workId).localeCompare(name(b.workId),'es')||String(a.workId).localeCompare(String(b.workId))||String(date(a)||'').localeCompare(String(date(b)||''))||String(a.id||'').localeCompare(String(b.id||''));
 const taskDay=t=>journalValidDay(t.dueDate)?t.dueDate:journalEntryDay(t);
 const state=t=>({pendiente:'Pendiente',proceso:'En proceso',terminado:'Realizada'}[t.status]||t.status||'Pendiente');
 const typed=(prefix,kind)=>settings.filter(r=>typeof r.id==='string'&&r.id.startsWith(prefix)&&r.value?.kind===kind&&!r.value.deletedAt).map(r=>r.value).filter(matches);
 const W=allWorks.filter(w=>wid==='all'||w.id===wid).sort((a,b)=>a.name.localeCompare(b.name,'es'));
 const A=allActs.filter(x=>matches(x)&&inRange(x.date)).sort(order(x=>x.date));
 const T=allTasks.filter(x=>matches(x)&&inRange(taskDay(x))).sort(order(taskDay));
 const P=allWorkers.filter(matches).sort(order(x=>x.name)),C=allCrews.filter(x=>matches(x)&&inRange(x.date)).sort(order(x=>x.date));
 const M=typed(MATERIAL_PREFIX,'field-material').filter(m=>inRange(materialRecordDay(m))).sort(order(materialRecordDay));
 const notes=typed(NOTE_PREFIX,'journal-note').filter(n=>inRange(journalEntryDay(n)));
 const noteById=new Map(typed(NOTE_PREFIX,'journal-note').map(n=>[n.id,n]));
 const tasksById=new Map(allTasks.filter(matches).map(t=>[t.id,t]));
 const linkedTask=n=>{const t=tasksById.get(n.linkedTaskId);return t&&t.workId===n.workId&&t.sourceNoteId===n.id?t:null};
 const linkedNote=t=>{const n=noteById.get(t.sourceNoteId);return n&&n.workId===t.workId&&n.linkedTaskId===t.id?n:null};
 // Una nota y su tarea son dos registros diferentes. Se conservan sus claves para vincularlos.
 const notebook=[...notes.map(n=>({workId:n.workId,id:n.id,day:journalEntryDay(n),row:[name(n.workId),exportDate(journalEntryDay(n)),exportTime(n.createdAt),'Nota',n.text,'','','',NOTE_PREFIX+n.id,linkedTask(n)?.id||'']})),...T.map(t=>({workId:t.workId,id:t.id,day:taskDay(t),row:[name(t.workId),exportDate(taskDay(t)),exportTime(t.createdAt),'Tarea',[t.title,t.description].filter(Boolean).join('\n'),exportDate(t.dueDate)+(t.dueTime?' '+t.dueTime:''),state(t),exportStamp(t.completedAt),t.id,linkedNote(t)?NOTE_PREFIX+t.sourceNoteId:'']}))].sort(order(x=>x.day));
 // Semanas completas que intersectan el periodo, incluidas marcas fuera de sus límites diarios.
 const groups=new Map(),workersById=new Map(allWorkers.map(w=>[w.id,w]));
 for(const mark of typed(ATTENDANCE_PREFIX,'field-attendance')){
  if(!journalValidDay(mark.date))continue;
  const start=attendanceSunday(mark.date),end=attendanceDay(start,6);if(start>to||end<from)continue;
  const key=JSON.stringify([mark.workId,mark.workerId,start]);
  if(!groups.has(key))groups.set(key,{workId:mark.workId,id:mark.workerId,start,end,marks:[]});groups.get(key).marks.push(mark);
 }
 // Completa cada semana registrada con los trabajadores activos, incluso sin marcas.
 const weeks=new Map([...groups.values()].map(g=>[JSON.stringify([g.workId,g.start]),g]));
 for(const week of weeks.values())for(const worker of P.filter(w=>w.workId===week.workId&&!w.attendanceInactive)){
  const key=JSON.stringify([week.workId,worker.id,week.start]);if(!groups.has(key))groups.set(key,{workId:week.workId,id:worker.id,start:week.start,end:week.end,marks:[]});
 }
 const attendance=[...groups.values()].sort(order(x=>x.start)).map(g=>{
  const latest=g.marks.slice().sort((a,b)=>String(b.updatedAt||b.createdAt||b.date).localeCompare(String(a.updatedAt||a.createdAt||a.date)))[0]||{},worker=workersById.get(g.id);
  const days=Array.from({length:7},(_,i)=>attendanceSymbol(g.marks.find(m=>m.date===attendanceDay(g.start,i))?.status));
  return [name(g.workId),exportDate(g.start)+' — '+exportDate(g.end),latest.workerName||worker?.name||'Trabajador anterior',latest.workerTrade||worker?.trade||'',attendanceCrewNames.get(attendanceCrewId(worker))||'Sin cuadrilla',...days,days.filter(x=>x==='✓').length];
 });
 const sheets=[
 ['Obras',[['Nombre','Ubicación','Inicio','Término previsto','Estado','Descripción / observaciones'],...W.map(x=>[x.name,x.location,exportDate(x.startDate),exportDate(x.endDate),x.status,x.notes])]],
 ['Actividades',[['Obra','Fecha','Hora','Actividad','Ubicación','Trabajos realizados','Observaciones / acciones','Personal participante','Referencias de fotos'],...A.map(x=>[name(x.workId),exportDate(x.date),x.time,x.title,x.location,x.description,x.notes,(x.workerIds||[]).map(id=>workersById.get(id)?.name||'').join(', '),allPhotos.filter(p=>p.workId===x.workId&&p.activityId===x.id).map(p=>p.id).join(', ')])]],
 ['Pendientes',[['Obra','Título','Descripción','Fecha de registro','Fecha límite','Prioridad','Estado','Seguimiento','Hora programada','Realizada el','ID de tarea','Nota original'],...T.map(x=>[name(x.workId),x.title,x.description,exportDate(journalLocalDate(x.createdAt)),exportDate(x.dueDate),x.priority,state(x),x.followup,x.dueTime,exportStamp(x.completedAt),x.id,linkedNote(x)?NOTE_PREFIX+x.sourceNoteId:''])]],
 ['Personal',[['Obra','Tipo','Nombre u oficio','Función / cantidad','Cuadrilla de asistencia','Fecha','Observaciones'],...[...P.map(x=>({workId:x.workId,id:x.id,day:'',row:[name(x.workId),'Trabajador',x.name,x.trade,attendanceCrewNames.get(attendanceCrewId(x))||'Sin cuadrilla','',x.notes]})),...C.flatMap(x=>Object.entries(x.counts||{}).map(([tr,n])=>({workId:x.workId,id:x.id+tr,day:x.date,row:[name(x.workId),'Cuadrilla diaria',tr,Number(n),'',exportDate(x.date),x.notes||'']})))].sort(order(x=>x.day)).map(x=>x.row)]],
 ['Materiales',[['Obra','Fecha de trabajo','Material','Cantidad','Unidad','Observaciones','Fecha y hora de captura','Última modificación'],...M.map(m=>[name(m.workId),exportDate(materialRecordDay(m)),m.material,Number(m.quantity),m.unit,m.observation,exportStamp(m.createdAt),exportStamp(m.updatedAt)])]],
 ['Mi libreta',[['Obra','Fecha de la página','Hora de anotación','Tipo de registro','Descripción','Fecha programada','Estado de la tarea','Fecha y hora de realización','ID del registro','Registro vinculado'],...notebook.map(x=>x.row)]],
 ['Asistencia semanal',[['Obra','Semana (domingo a sábado)','Nombre completo','Cargo','Cuadrilla de asistencia','D','L','M','M','J','V','S','Total de asistencias'],...attendance]]
 ];
 const ns='http://schemas.openxmlformats.org',styles='<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="'+ns+'/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173F35"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
 const e=[['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="'+ns+'/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'],
 ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="'+ns+'/package/2006/relationships"><Relationship Id="rId1" Type="'+ns+'/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
 ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="'+ns+'/spreadsheetml/2006/main" xmlns:r="'+ns+'/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>'+sheets.map(([n],i)=>'<sheet name="'+xml(n)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>'],
 ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="'+ns+'/package/2006/relationships">'+sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+ns+'/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rStyles" Type="'+ns+'/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],['xl/styles.xml',styles],...sheets.map(([,rows],i)=>['xl/worksheets/sheet'+(i+1)+'.xml',sheet(rows)])];
 const zip=await makeZip(e);download(new Blob([zip],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'agenda-obra-'+journalLocalDate()+'.xlsx');
}
$('#quickBtn').onclick=()=>modal('Agregar registro','<div class="stack"><button type="button" class="btn" data-action="new-note">＋ Anotación libre</button><button type="button" class="btn light" data-action="new-activity">＋ Actividad ejecutada</button><button type="button" class="btn light" data-action="new-task">＋ Pendiente</button></div>','Listo');$('#quickBtn').addEventListener('click',()=>{$('#modal').querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{$('#modal').classList.add('hidden');action(b.dataset.action)})});$('#toolsBtn').onclick=()=>go('more');document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>go(b.dataset.page));window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#installBtn').classList.remove('hidden')});$('#installBtn').onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('#installBtn').classList.add('hidden')}};
// Instalación y actualizaciones del programa; no accede al almacenamiento de registros.
async function setupPwaUpdates(){
 if(!('serviceWorker' in navigator))return;
 let registration,requested=false,controlled=!!navigator.serviceWorker.controller,lastCheck=0;
 const busy=()=>!$('#modal').classList.contains('hidden')||attendancePending>0;
 function notice(message='Hay una nueva versión disponible. Guarda lo que estés escribiendo antes de actualizar.'){
  let box=$('#pwa-update');
  if(!box){box=document.createElement('aside');box.id='pwa-update';box.className='pwa-update';box.setAttribute('aria-label','Actualización de la aplicación');box.innerHTML='<p role="status"></p><div class="row"><button type="button" class="btn light small" data-later>Más tarde</button><button type="button" class="btn small" data-update>Actualizar ahora</button></div>';document.body.append(box);
   box.querySelector('[data-later]').onclick=()=>{box.hidden=true};
   box.querySelector('[data-update]').onclick=()=>{
    if(busy()){box.querySelector('p').textContent='Termina de guardar o cancela el formulario abierto antes de actualizar.';return}
    if(registration.waiting){requested=true;box.querySelector('[data-update]').disabled=true;box.querySelector('p').textContent='Aplicando actualización…';registration.waiting.postMessage({type:'APPLY_UPDATE'})}
    else if(navigator.serviceWorker.controller)location.reload();
   };
  }
  box.hidden=false;box.querySelector('p').textContent=message;
 }
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(!controlled){controlled=true;return}
  if(requested&&!busy()){location.reload();return}
  requested=false;const button=$('#pwa-update [data-update]');if(button)button.disabled=false;
  notice('La nueva versión está lista. Guarda tu trabajo y pulsa Actualizar ahora para abrirla.');
 });
 registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
 function waiting(){if(registration.waiting)notice()}
 registration.addEventListener('updatefound',()=>{const worker=registration.installing;if(worker)worker.addEventListener('statechange',()=>{if(worker.state==='installed')waiting()})});
 waiting();
 async function check(){
  if(!navigator.onLine||document.visibilityState==='hidden'||Date.now()-lastCheck<60000)return;
  lastCheck=Date.now();try{await registration.update();waiting()}catch(error){console.info('Sin actualización disponible por ahora',error)}
 }
 window.addEventListener('online',check);document.addEventListener('visibilitychange',check);await check();
}
(async()=>{try{db=await openDB();let saved=await get('settings','activeWork');if(saved)activeWork=saved.value;await render();setupPwaUpdates().catch(e=>console.warn('SW',e))}catch(e){console.error(e);$('#view').innerHTML=empty('No se pudo iniciar','IndexedDB no está disponible en este navegador.')}})();
