(function () {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const supa = window.feriaSupabase;
  const authView = $('#authView'), participantView = $('#participantView');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const say = (selector, message, ok = false) => { const el=$(selector); el.textContent=message; el.classList.toggle('success',ok); };
  const objectiveLabels={comprar:'Comprar productos o servicios',vender:'Vender productos o servicios',proveedores:'Encontrar proveedores',clientes:'Conseguir nuevos clientes',distribuidores:'Buscar distribuidores o representantes',socios:'Encontrar socios estratégicos',inversionistas:'Buscar inversionistas o financiamiento',mercados:'Explorar nuevos mercados',contactos:'Ampliar su red de contactos'};
  const sectors=[...document.querySelectorAll('#profileForm select[name="sector"] option')].map(option=>option.value).filter(value=>value&&value!=='otro');
  const departments=['Tarija','Chuquisaca','La Paz','Cochabamba','Oruro','Potosí','Santa Cruz','Beni','Pando'];
  const sectorKey=value=>String(value||'').toLocaleLowerCase('es-BO').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
  const sectorMap=new Map(sectors.map(value=>[sectorKey(value),value]));
  [['vino','Vino y singani'],['campo','Agricultura y ganadería'],['agropecuaria','Agricultura y ganadería'],['agricultura','Agricultura y ganadería'],['ganaderia','Agricultura y ganadería'],['artesania','Artesanía'],['gastronomia','Alimentos y bebidas'],['alimentos','Alimentos y bebidas'],['servicios','Servicios profesionales'],['tecnologia e innovacion','Tecnología'],['logistica','Transporte y logística']].forEach(([alias,sector])=>sectorMap.set(sectorKey(alias),sector));
  const normalizeLocation=value=>String(value||'').trim().replace(/\s+/g,' ').split(' ').map(word=>word.charAt(0).toLocaleUpperCase('es-BO')+word.slice(1).toLocaleLowerCase('es-BO')).join(' ');
  const sectorLabel=value=>{const raw=String(value||'').trim(),other=raw.match(/^Otro:\s*(.*)$/i);if(other)return `Otro rubro — ${other[1]}`;return sectorMap.get(sectorKey(raw))|| (raw?`Otro rubro — ${raw}`:'');};
  function splitProvenance(value){
    const parts=String(value||'').split(',').map(part=>part.trim()).filter(Boolean);
    if(parts.length>1){const region=parts.at(-1);if(departments.includes(region))return {city:parts.slice(0,-1).join(', '),department:region,country:''};return {city:parts.slice(0,-1).join(', '),department:'internacional',country:region};}
    if(departments.includes(parts[0]))return {city:parts[0],department:parts[0],country:''};
    return {city:parts[0]||'',department:'',country:''};
  }
  function updateCatalogFields(){
    const form=$('#profileForm'),otherSector=form.elements.sector.value==='otro',international=form.elements.provenance_department.value==='internacional';
    $('#otherSectorField').hidden=!otherSector;form.elements.sector_other.required=otherSector;
    $('#provenanceCountryField').hidden=!international;form.elements.provenance_country.required=international;
  }
  let user = null, profile = null;
  let profileStep=0;

  function showProfileStep(index){
    profileStep=Math.max(0,Math.min(2,index));
    document.querySelectorAll('[data-profile-step]').forEach((step,i)=>step.hidden=i!==profileStep);
    document.querySelectorAll('[data-step-indicator]').forEach((item,i)=>{item.classList.toggle('is-current',i===profileStep);item.classList.toggle('is-done',i<profileStep);});
    $('#profileStepLabel').textContent=`Paso ${profileStep+1} de 3`;
    $('#profileBack').hidden=profileStep===0;$('#profileNext').hidden=profileStep===2;
    $('#profileForm [type="submit"]').hidden=profileStep!==2;
  }

  function updateOverview(){
    const ready=Boolean(profile?.company_name&&profile?.sector&&profile?.contact_name&&profile?.phone&&profile?.offer&&profile?.demand&&profile?.objectives?.length&&profile?.published&&Number(profile?.directory_consent_version)>=2);
    $('#roundProfileState').textContent=ready?'Completo':'Pendiente';
    $('#roundProfileState').classList.toggle('is-ready',ready);
  }

  let businessSchedule={meeting_dates:['2026-12-08','2026-12-09'],meeting_minutes:20,transition_minutes:5};
  const businessDates=()=>businessSchedule.meeting_dates.map(value=>[value,new Intl.DateTimeFormat('es-BO',{timeZone:'UTC',day:'numeric',month:'long'}).format(new Date(`${value}T12:00:00Z`))]);
  const meetingDateOptions=selected=>businessDates().map(([value,label])=>`<option value="${value}" ${value===selected?'selected':''}>${label}</option>`).join('');
  async function loadBusinessSchedule(){const {data,error}=await client.rpc('get_business_round_schedule');if(!error&&data?.meeting_dates?.length)businessSchedule=data;}
  async function fillMeetingSlots(form,excludeMeetingId=''){
    const date=form.elements.meeting_date.value,select=form.elements.meeting_time,invitee=form.dataset.invitee||form.dataset.otherCompanyId;
    select.disabled=true;select.innerHTML='<option value="">Consultando horarios…</option>';
    const {data,error}=await client.rpc('list_business_round_available_slots',{p_invitee_id:invitee,p_meeting_date:date,p_exclude_meeting_id:excludeMeetingId||null});
    if(error){select.innerHTML='<option value="">No se pudieron cargar los horarios</option>';return;}
    select.innerHTML=(data||[]).map(row=>{const time=String(row.meeting_time).slice(0,5);return `<option value="${esc(time)}">${esc(time)}</option>`;}).join('')||'<option value="">Sin horarios disponibles</option>';
    select.disabled=!(data||[]).length;
    form.dataset.slotsLoaded='true';
    form.querySelector('[data-load-meeting-slots]')?.setAttribute('hidden','');
  }

  function renderCompanyCards(rows, target, recommendation=false) {
    target.innerHTML=rows.map(row=>{
      const meetingForm=profile?.published&&Number(profile.directory_consent_version)>=2?`<form class="round-meeting" data-invitee="${esc(row.company_id)}"><strong>Proponer reunión</strong><p class="round-muted">${businessSchedule.meeting_minutes} minutos de reunión y ${businessSchedule.transition_minutes} minutos de transición.</p><div class="two"><label>Fecha<select name="meeting_date">${meetingDateOptions(businessDates()[0]?.[0])}</select></label><label>Hora disponible<select name="meeting_time" disabled><option value="">Consulta los horarios disponibles</option></select></label></div><button class="btn ghost" type="button" data-load-meeting-slots>Consultar horarios</button><button class="btn primary" type="submit">Enviar solicitud</button><span class="round-status" role="status"></span></form>`:'<p class="round-muted">Acepta la autorización actualizada para proponer reuniones.</p>';
      const ownObjectives=profile?.objectives||[], companyObjectives=row.objectives||[];
      const shared=companyObjectives.filter(value=>ownObjectives.includes(value));
      const score=Number(row.match_score)||0;
      const words=value=>new Set(String(value||'').toLocaleLowerCase('es-BO').normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]{3,}/g)||[]);
      const overlap=(left,right)=>[...words(left)].filter(word=>words(right).has(word));
      const evidence=[];
      const demandTerms=overlap(profile?.demand,row.offer);
      if(demandTerms.length)evidence.push(`Tu demanda coincide con su oferta: ${demandTerms.slice(0,4).join(', ')}`);
      const supplyTerms=overlap(profile?.offer,row.demand);
      if(supplyTerms.length)evidence.push(`Tu oferta coincide con su demanda: ${supplyTerms.slice(0,4).join(', ')}`);
      if(profile?.sector&&row.sector&&sectorKey(profile.sector)===sectorKey(row.sector))evidence.push(`Mismo rubro: ${sectorLabel(row.sector)||row.sector}`);
      if(shared.length)evidence.push(`Objetivos compartidos: ${shared.map(value=>objectiveLabels[value]||value).join(', ')}`);
      if((ownObjectives.includes('comprar')||ownObjectives.includes('proveedores'))&&(companyObjectives.includes('vender')||companyObjectives.includes('clientes')))evidence.push('Complemento comercial: buscas comprar o encontrar proveedores y la empresa busca vender o conseguir clientes');
      if((companyObjectives.includes('comprar')||companyObjectives.includes('proveedores'))&&(ownObjectives.includes('vender')||ownObjectives.includes('clientes')))evidence.push('Complemento comercial: la empresa busca comprar o encontrar proveedores y tú buscas vender o conseguir clientes');
      const explanation=evidence.length?evidence:[recommendation?'La búsqueda encontró términos relacionados en la oferta, demanda, rubro u objetivos de esta empresa.':'Coincide con los términos de tu búsqueda.'];
      return `<article class="round-match"><div class="round-company-heading"><h3>${esc(row.company_name)}</h3>${score?`<span class="round-score" title="Puntaje interno de coincidencia; sirve para ordenar resultados, no es un porcentaje.">Afinidad: ${score} puntos</span>`:''}</div><p><strong>Rubro:</strong> ${esc(sectorLabel(row.sector)||'No especificado')}</p><div class="round-reasons"><strong>Por qué aparece</strong><ul>${explanation.map(value=>`<li>${esc(value)}</li>`).join('')}</ul><small>La afinidad es un puntaje de ordenamiento, no una probabilidad ni una garantía de negocio.</small></div><p><strong>Oferta:</strong> ${esc(row.offer)}</p><p><strong>Demanda:</strong> ${esc(row.demand)}</p>${row.objectives?.length?`<p><strong>Objetivos:</strong> ${row.objectives.map(value=>esc(objectiveLabels[value]||value)).join(' · ')}</p>`:''}${meetingForm}</article>`;
    }).join('')||'<p class="round-muted">No se encontraron empresas.</p>';
  }

  if (!supa?.enabled) { say('#authStatus','El panel requiere que Supabase esté configurado.'); return; }
  const client=supa.client;

  async function signInWithGoogle(){
    const button=$('#googleLogin');button.disabled=true;say('#authStatus','Conectando con Google…');
    const redirectTo=window.location.origin+window.location.pathname;
    try{
      const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo,queryParams:{prompt:'select_account'}}});
      if(error)throw error;
      say('#authStatus','Abriendo Google…',true);
    }catch(error){
      button.disabled=false;
      const message=/unsupported provider|provider.*(not enabled|disabled)/i.test(error.message||'')
        ?'El acceso con Google todavía no está habilitado en Supabase. La Fundación debe configurarlo en Authentication → Sign In / Providers → Google.'
        :'No se pudo iniciar sesión con Google. Intenta de nuevo o contacta a la Fundación.';
      say('#authStatus',message);return;
    }
  }
  $('#googleLogin').addEventListener('click',signInWithGoogle);
  const callbackParams=new URLSearchParams(window.location.search),callbackHash=new URLSearchParams(window.location.hash.replace(/^#/,''));
  const callbackError=callbackParams.get('error_description')||callbackHash.get('error_description');
  if(callbackError)say('#authStatus','Google no pudo completar el acceso: '+callbackError);

  async function loadMeetings() {
    const box=$('#myMeetings'); box.innerHTML='<p class="round-muted">Cargando…</p>';
    const {error:expiryError}=await client.rpc('expire_business_round_meeting_requests');
    if(expiryError)console.warn('No se pudieron actualizar las solicitudes vencidas:',expiryError);
    const {data,error}=await client.rpc('list_business_round_meetings');
    if(error){box.innerHTML='<p class="round-muted">No se pudieron cargar las reuniones.</p>';return;}
    const meetingIds=(data||[]).map(row=>row.id);
    let outcomes=[];
    if(meetingIds.length){const result=await client.from('business_round_meeting_outcomes').select('meeting_id,participant_id,outcome,next_step,follow_up_on,notes').in('meeting_id',meetingIds).eq('participant_id',profile?.id);if(!result.error)outcomes=result.data||[];else console.warn('No se pudo cargar el seguimiento; ejecuta la migración Etapa 6 de la Rueda en Supabase.',result.error);}
    const outcomesByMeeting=new Map(outcomes.map(item=>[item.meeting_id,item]));
    const statusLabels={pendiente:'Pendiente',alternativa:'Horario alternativo',confirmada:'Confirmada',rechazada:'Rechazada',vencida:'Vencida',cancelada:'Cancelada'};
    const rows=data||[],pending=rows.filter(row=>['pendiente','alternativa'].includes(row.status)),confirmed=rows.filter(row=>row.status==='confirmada'),closed=rows.filter(row=>['rechazada','vencida','cancelada'].includes(row.status));
    const now=Date.now(),upcoming=confirmed.filter(row=>Date.parse(`${row.meeting_date}T${String(row.meeting_time).slice(0,8)}-04:00`)>now).sort((a,b)=>`${a.meeting_date}${a.meeting_time}`.localeCompare(`${b.meeting_date}${b.meeting_time}`));
    const needsResponse=pending.filter(row=>row.can_respond);
    $('#roundPendingCount').textContent=String(needsResponse.length);$('#roundUpcomingCount').textContent=String(upcoming.length);
    $('#roundNextMeeting').textContent=upcoming[0]?`Siguiente: ${upcoming[0].meeting_date} · ${String(upcoming[0].meeting_time).slice(0,5)}`:'Sin reuniones próximas';
    const renderCard=row=>{
      const active=['pendiente','alternativa','confirmada'].includes(row.status),startsAt=Date.parse(`${row.meeting_date}T${String(row.meeting_time).slice(0,8)}-04:00`),canCancel=active&&Number.isFinite(startsAt)&&startsAt>Date.now();
      const personalState=row.status==='pendiente'?(row.can_respond?'Tu respuesta pendiente':'Esperando respuesta'):row.status==='alternativa'?(row.can_respond?'Responde el horario alternativo':'Horario alternativo enviado'):(statusLabels[row.status]||row.status);
      const past=row.status==='confirmada'&&Number.isFinite(startsAt)&&startsAt<Date.now(),outcome=outcomesByMeeting.get(row.id),outcomeOptions=[['contacto','Se estableció contacto'],['cotizacion','Se solicitó o envió cotización'],['negociacion','Negociación en curso'],['acuerdo','Se concretó un acuerdo'],['seguimiento','Requiere seguimiento'],['sin_avance','Sin avance por ahora']];
      const followup=past?`<details class="round-outcome"><summary>${outcome?'Actualizar resultado':'Registrar resultado de la reunión'}</summary><form class="round-outcome-form" data-outcome-meeting="${esc(row.id)}"><label>Resultado<select name="outcome" required><option value="">Selecciona una opción</option>${outcomeOptions.map(([value,label])=>`<option value="${value}" ${outcome?.outcome===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Próximo paso<textarea name="next_step" rows="2" maxlength="1000" placeholder="Ej.: Enviar catálogo y coordinar una llamada">${esc(outcome?.next_step||'')}</textarea></label><label>Fecha de seguimiento<input name="follow_up_on" type="date" value="${esc(outcome?.follow_up_on||'')}"></label><label>Nota privada para la Fundación<textarea name="notes" rows="2" maxlength="1000" placeholder="Información útil para el seguimiento institucional">${esc(outcome?.notes||'')}</textarea></label><small>La otra empresa no verá este registro. La Fundación podrá consultar los resultados para evaluar la Rueda.</small><button class="btn primary" type="submit">Guardar resultado</button><span class="round-status" role="status"></span></form></details>`:'';
      return `<article class="round-meeting-card"><div class="round-meeting-card-head"><strong>${esc(row.meeting_date)} · ${esc(String(row.meeting_time).slice(0,5))}</strong><span class="round-state round-state-${esc(row.status)}">${esc(personalState)}</span></div><strong class="round-meeting-company">${esc(row.other_company)}</strong><p>${businessSchedule.meeting_minutes} minutos + ${businessSchedule.transition_minutes} de transición${row.table_number?` · Mesa ${row.table_number}`:''}</p>${canCancel?`<div class="round-meeting-cancel"><button class="btn ghost" type="button" data-cancel-personal-meeting="${esc(row.id)}">Cancelar reunión</button></div>`:''}${row.can_respond?`<form class="round-response" data-meeting-id="${esc(row.id)}" data-other-company-id="${esc(row.other_company_id)}"><div class="round-response-actions"><button class="btn primary" type="button" data-response-action="aceptar">Aceptar horario</button><button class="btn ghost" type="button" data-response-action="rechazar">Rechazar</button><button class="btn ghost" type="button" data-response-action="mostrar-propuesta">Proponer otro horario</button></div><div class="round-alt-fields" hidden><label>Fecha<select name="meeting_date">${meetingDateOptions(businessSchedule.meeting_dates[0])}</select></label><label>Horario disponible<select name="meeting_time" disabled><option value="">Consulta los horarios disponibles</option></select></label><button class="btn ghost" type="button" data-load-meeting-slots>Consultar horarios</button><button class="btn primary" type="button" data-response-action="proponer">Enviar horario alternativo</button></div><span class="round-status" role="status"></span></form>`:''}${followup}</article>`;
    };
    const renderSection=(title,items)=>{
      if(!items.length)return '';
      const dateGroups=new Map();
      [...items].sort((a,b)=>`${a.meeting_date}${a.meeting_time}`.localeCompare(`${b.meeting_date}${b.meeting_time}`)).forEach(row=>{if(!dateGroups.has(row.meeting_date))dateGroups.set(row.meeting_date,[]);dateGroups.get(row.meeting_date).push(row);});
      return `<section class="round-agenda-section"><h3>${title}</h3>${[...dateGroups].map(([date,dayRows])=>`<div class="round-agenda-day"><h4>${esc(date)}</h4><div class="round-agenda-cards">${dayRows.map(renderCard).join('')}</div></div>`).join('')}</section>`;
    };
    box.innerHTML=[renderSection('Responde estas solicitudes',needsResponse),renderSection('Esperando respuesta',pending.filter(row=>!row.can_respond)),renderSection('Reuniones confirmadas',confirmed),renderSection('Historial',closed)].join('')||'<p class="round-muted">Aún no tienes reuniones. Busca empresas y envía una propuesta para comenzar.</p>';
  }

  async function searchCompatibleCompanies() {
    const box=$('#matchResults');
    if(!profile){say('#searchStatus','Completa y guarda el perfil para buscar empresas compatibles automáticamente.');box.innerHTML='';return;}
    if(!profile.published||Number(profile.directory_consent_version)<2){say('#searchStatus','Guarda tu perfil aceptando la autorización actualizada para aparecer en las recomendaciones.');box.innerHTML='';return;}
    say('#searchStatus','Buscando empresas compatibles según tu demanda…');box.innerHTML='';
    const {data,error}=await client.rpc('search_business_round_matches',{p_query:`${profile.demand} ${profile.offer} ${profile.sector||''} ${(profile.objectives||[]).join(' ')}`});
    if(error){say('#searchStatus','No se pudo completar la búsqueda automática. Verifica la configuración de Supabase.');return;}
    const results=(data||[]).filter(row=>row.company_id!==profile.id);
    if(!results.length){say('#searchStatus','Aún no hay empresas compatibles con las palabras clave de tu demanda.');return;}
    say('#searchStatus',`${results.length} empresa(s) compatible(s), ordenadas por afinidad.`);
    renderCompanyCards(results,box,true);
  }

  async function showUser(currentUser) {
    user=currentUser;
    authView.hidden=Boolean(currentUser); participantView.hidden=!currentUser;
    if(!currentUser){
      profile=null;$('#signedInEmail').textContent='';$('#profileForm').reset();$('#matchResults').innerHTML='';$('#directoryResults').innerHTML='';$('#myMeetings').innerHTML='';
      return;
    }
    $('#profileForm').reset();showProfileStep(0);$('#matchResults').innerHTML='';
    $('#signedInEmail').textContent=`Sesión iniciada como ${currentUser.email||''}`;
    await loadBusinessSchedule();
    const {data,error}=await client.from('business_round_participants').select('id,company_name,sector,provenance,contact_name,phone,offer,demand,objectives,published,directory_consent_version,email_notifications,whatsapp_notifications').eq('user_id',currentUser.id).maybeSingle();
    if(error){
      console.error('Error al consultar el perfil de la Rueda de Negocios:',error);
      const code=String(error.code||''),message=String(error.message||'Error desconocido.');
      const cause=code==='42P01'?'No existe la tabla de participantes. ':code==='42703'||code==='PGRST204'?'Falta una columna del perfil o la caché de esquema de Supabase no se actualizó. ':code==='42501'?'Supabase denegó la lectura del perfil; revisa el permiso SELECT y la política RLS para usuarios autenticados. ':'';
      say('#profileStatus',`No se pudo consultar el perfil. ${cause}${code?`[${code}] `:''}${message}`);return;
    }
    profile=data||null;
    const form=$('#profileForm');
    if(profile){
      for(const key of ['company_name','contact_name','phone','offer','demand'])form.elements[key].value=profile[key]||'';
      const savedSector=String(profile.sector||''),catalogSector=sectorMap.get(sectorKey(savedSector));
      form.elements.sector.value=catalogSector||'otro';form.elements.sector_other.value=catalogSector?'':savedSector.replace(/^Otro:\s*/i,'');
      const location=splitProvenance(profile.provenance);form.elements.provenance_city.value=location.city;form.elements.provenance_department.value=location.department;form.elements.provenance_country.value=location.country;
      form.querySelectorAll('input[name="objectives"]').forEach(input=>input.checked=(profile.objectives||[]).includes(input.value));form.elements.consent.checked=profile.published&&Number(profile.directory_consent_version)>=2;form.elements.email_notifications.checked=profile.email_notifications!==false;form.elements.whatsapp_notifications.checked=profile.whatsapp_notifications===true;
    }
    updateCatalogFields();
    updateOverview();
    await loadMeetings();await searchCompatibleCompanies();
  }

  $('#logoutButton').addEventListener('click',async()=>{await client.auth.signOut();await showUser(null);});

  $('#profileForm').addEventListener('submit',async event=>{
    event.preventDefault();if(!user)return;
    const form=event.currentTarget,button=form.querySelector('button[type="submit"]');
    const objectives=[...form.querySelectorAll('input[name="objectives"]:checked')].map(input=>input.value);
    if(!objectives.length)return say('#profileStatus','Selecciona al menos un objetivo comercial.');
    const sector=form.elements.sector.value==='otro'?`Otro: ${form.elements.sector_other.value.trim()}`:form.elements.sector.value;
    const city=normalizeLocation(form.elements.provenance_city.value),region=form.elements.provenance_department.value==='internacional'?normalizeLocation(form.elements.provenance_country.value):form.elements.provenance_department.value;
    const record={user_id:user.id,company_name:form.elements.company_name.value.trim(),sector,provenance:`${city}, ${region}`,contact_name:form.elements.contact_name.value.trim(),phone:form.elements.phone.value.trim(),offer:form.elements.offer.value.trim(),demand:form.elements.demand.value.trim(),objectives,published:form.elements.consent.checked,directory_consent_version:2,email_notifications:form.elements.email_notifications.checked,whatsapp_notifications:form.elements.whatsapp_notifications.checked};
    button.disabled=true;say('#profileStatus','Guardando perfil…');
    const query=profile?client.from('business_round_participants').update(record).eq('id',profile.id):client.from('business_round_participants').insert(record);
    const {error}=await query;
    button.disabled=false;
    if(error){say('#profileStatus','No se pudo guardar el perfil. Verifica la configuración de Supabase e intenta de nuevo.');return;}
    say('#profileStatus','Perfil guardado. Se actualizará automáticamente la búsqueda de empresas compatibles.',true);
    const {data}=await client.from('business_round_participants').select('id,company_name,sector,provenance,contact_name,phone,offer,demand,objectives,published,directory_consent_version,email_notifications,whatsapp_notifications').eq('user_id',user.id).maybeSingle();profile=data||null;await searchCompatibleCompanies();
    updateOverview();
  });

  $('#profileForm').addEventListener('change',event=>{if(event.target.name==='sector'||event.target.name==='provenance_department')updateCatalogFields();});

  $('#profileBack').addEventListener('click',()=>showProfileStep(profileStep-1));
  $('#profileNext').addEventListener('click',()=>{
    const step=document.querySelector(`[data-profile-step="${profileStep}"]`);
    if(profileStep===2&&!$('#profileForm').querySelectorAll('input[name="objectives"]:checked').length){say('#profileStatus','Selecciona al menos un objetivo comercial.');return;}
    const invalid=[...step.querySelectorAll('input,select,textarea')].find(control=>!control.checkValidity());
    if(invalid){invalid.reportValidity();return;}
    say('#profileStatus','');showProfileStep(profileStep+1);document.querySelector('#roundProfile h2').scrollIntoView({behavior:'smooth',block:'start'});
  });

  const sectorFilter=$('#companySearchForm').elements.sector;
  sectors.forEach(value=>{const option=document.createElement('option');option.value=value;option.textContent=sectorLabel(value);sectorFilter.append(option);});

  $('#companySearchForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!user)return say('#directoryStatus','Inicia sesión para buscar empresas.');
    if(!profile||Number(profile.directory_consent_version)<2)return say('#directoryStatus','Guarda tu perfil y acepta la autorización actualizada para acceder al directorio.');
    const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),query=form.elements.query.value.trim(),box=$('#directoryResults');
    if(query.length===1)return say('#directoryStatus','Escribe al menos dos caracteres para buscar.');
    button.disabled=true;box.innerHTML='';say('#directoryStatus','Buscando empresas…');
    const {data,error}=await client.rpc('search_business_round_directory',{p_query:query,p_sector:form.elements.sector.value||'',p_department:form.elements.department.value||''});
    button.disabled=false;
    if(error){say('#directoryStatus','No se pudo buscar. Ejecuta Querys/supabase-business-round-directory-filters.sql en Supabase.');return;}
    const results=(data||[]).filter(row=>row.company_id!==profile?.id);
    say('#directoryStatus',`${results.length} empresa(s) encontrada(s).`);
    renderCompanyCards(results,box);
  });

  async function submitMeetingProposal(event){
    const form=event.target.closest('.round-meeting');if(!form)return;event.preventDefault();
    const button=form.querySelector('button[type="submit"]'),status=form.querySelector('.round-status');
    if(!form.elements.meeting_time.value){status.textContent='Consulta y selecciona un horario disponible.';return;}
    button.disabled=true;status.textContent='Enviando solicitud…';
    const {error}=await client.rpc('request_business_round_meeting',{p_invitee_id:form.dataset.invitee,p_meeting_date:form.elements.meeting_date.value,p_meeting_time:form.elements.meeting_time.value,p_duration_minutes:businessSchedule.meeting_minutes});
    button.disabled=false;
    if(error){status.textContent=/horario|bloque|solicitud activa/i.test(error.message||'')?error.message:'No se pudo enviar la solicitud.';return;}
    status.textContent='Solicitud enviada; la otra empresa debe responder.';button.textContent='Solicitud enviada';await loadMeetings();
  }
  $('#matchResults').addEventListener('submit',submitMeetingProposal);
  $('#directoryResults').addEventListener('submit',submitMeetingProposal);
  function updateMeetingTimeOptions(event){
    const form=event.target.closest('.round-meeting,.round-response');if(!form||event.target.name!=='meeting_date')return;
    fillMeetingSlots(form,form.dataset.meetingId||'');
  }
  $('#matchResults').addEventListener('change',updateMeetingTimeOptions);
  $('#directoryResults').addEventListener('change',updateMeetingTimeOptions);
  $('#myMeetings').addEventListener('change',updateMeetingTimeOptions);
  async function loadSlotsFromButton(event){const button=event.target.closest('[data-load-meeting-slots]');if(button){const form=button.closest('.round-meeting,.round-response');await fillMeetingSlots(form,form.dataset.meetingId||'');}}
  $('#matchResults').addEventListener('click',loadSlotsFromButton);
  $('#directoryResults').addEventListener('click',loadSlotsFromButton);
  $('#myMeetings').addEventListener('click',loadSlotsFromButton);
  $('#myMeetings').addEventListener('click',async event=>{
    const cancelButton=event.target.closest('[data-cancel-personal-meeting]');
    if(cancelButton){
      if(!confirm('¿Cancelar esta reunión? Se notificará a la otra empresa.'))return;
      const reason=prompt('Motivo de cancelación (opcional):','');if(reason===null)return;
      cancelButton.disabled=true;
      const {error}=await client.rpc('cancel_business_round_meeting',{p_meeting_id:cancelButton.dataset.cancelPersonalMeeting,p_reason:reason.trim()||null});
      if(error){cancelButton.disabled=false;say('#myMeetingsStatus',error.message||'No se pudo cancelar la reunión.');return;}
      say('#myMeetingsStatus','Reunión cancelada. Se notificó a la otra empresa.',true);
      await loadMeetings();return;
    }
    const button=event.target.closest('[data-response-action]');if(!button)return;
    const form=button.closest('.round-response'),action=button.dataset.responseAction,status=form.querySelector('.round-status');
    if(action==='mostrar-propuesta'){const fields=form.querySelector('.round-alt-fields');fields.hidden=false;return;}
    const p_meeting_date=action==='proponer'?form.elements.meeting_date.value:null;
    const p_meeting_time=action==='proponer'?form.elements.meeting_time.value:null;
    if(action==='proponer'&&!p_meeting_time){status.textContent='Selecciona un horario disponible.';return;}
    form.querySelectorAll('button').forEach(item=>item.disabled=true);status.textContent='Guardando respuesta…';
    const {error}=await client.rpc('respond_business_round_meeting',{p_meeting_id:form.dataset.meetingId,p_action:action,p_meeting_date,p_meeting_time});
    if(error){status.textContent=error.message||'No se pudo actualizar la reunión.';form.querySelectorAll('button').forEach(item=>item.disabled=false);return;}
    await loadMeetings();
  });
  $('#myMeetings').addEventListener('submit',async event=>{
    const form=event.target.closest('.round-outcome-form');if(!form)return;event.preventDefault();
    const button=form.querySelector('[type="submit"]'),status=form.querySelector('.round-status');button.disabled=true;status.textContent='Guardando resultado…';
    const payload={meeting_id:form.dataset.outcomeMeeting,participant_id:profile?.id,outcome:form.elements.outcome.value,next_step:form.elements.next_step.value.trim()||null,follow_up_on:form.elements.follow_up_on.value||null,notes:form.elements.notes.value.trim()||null};
    const {error}=await client.from('business_round_meeting_outcomes').upsert(payload,{onConflict:'meeting_id,participant_id'});
    button.disabled=false;if(error){console.error('No se pudo guardar el resultado de la reunión:',error);status.textContent=/does not exist|schema cache|42P01/i.test(`${error.message||''} ${error.code||''}`)?'Falta ejecutar Querys/supabase-business-round-outcomes-stage6.sql en Supabase.':'No se pudo guardar. Verifica tu conexión e inténtalo de nuevo.';return;}
    status.textContent='Resultado guardado.';status.classList.add('success');await loadMeetings();
  });

  client.auth.getSession().then(({data})=>showUser(data.session?.user||null));
  client.auth.onAuthStateChange((event,session)=>{
    if(session?.user&&session.user.id!==user?.id)showUser(session.user);
    else if(event==='SIGNED_OUT')showUser(null);
  });
})();


