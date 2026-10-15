const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const origin = 'https://toolbox.test';
const source = fs.readFileSync(path.join(__dirname, '../static/service-worker.js'), 'utf8');
const tool = (id, version = '1') => ({id, name:id, image_url:`/uploads/${id}.png?v=${version}`});
function setup() {
  const stores = new Map();
  const handlers = {};
  let records = [tool('a'), tool('b')];
  let failure = null;
  let quota = false;
  const requests = [];
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const values = stores.get(name);
      return {
        async put(url, response) { if (quota) throw Error('Quota'); values.set(key(url), response.clone()); },
        async match(url) { return values.get(key(url))?.clone(); },
        async keys() { return [...values.keys()].map(url => ({url})); },
        async delete(url) { return values.delete(key(url)); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  const context = vm.createContext({
    URL, Response, AbortController, setTimeout, clearTimeout, caches,
    self: {location:{origin}, clients:{claim:async()=>{}, matchAll:async()=>[]},
      skipWaiting:async()=>{}, addEventListener:(name, handler)=>{handlers[name]=handler;}},
    fetch: async (url, options) => {
      requests.push({url:key(url), options});
      if (failure === 'network') throw Error('offline');
      if (key(url).endsWith('/api/tools')) {
        if (failure === 'server') return new Response('error', {status:503});
        if (failure === 'html') return new Response('<h1>Login</h1>', {headers:{'content-type':'text/html'}});
        return new Response(JSON.stringify(failure === 'invalid' ? {tools:[]} : {schema_version:1, tools:records}), {headers:{'content-type':'application/json'}});
      }
      if (failure === 'photo') return new Response('missing', {status:404});
      if (failure === 'photo-html') return new Response('<html>Login</html>', {headers:{'content-type':'text/html'}});
      return new Response('image-bytes', {headers:{'content-type':'image/png'}});
    }
  });
  vm.runInContext(source, context);
  return {
    stores, requests, caches, handlers,
    setRecords(value) { records=value; }, setFailure(value) { failure=value; }, setQuota(value) { quota=value; },
    sync:()=>vm.runInContext('synchronise()', context),
    read:()=>vm.runInContext('cachedCatalogue()', context),
    async photos() { return (await (await caches.open('toolbox-photos-v1')).keys()).map(item=>item.url); }
  };
}

test('sync stores all tools/photos, reuses images, updates and prunes deletions', async () => {
  const env = setup();
  assert.equal((await env.sync()).saved, true);
  assert.equal((await env.read()).tools.length, 2);
  env.requests.length=0;
  await env.sync();
  assert.equal(env.requests.length, 1);
  env.setRecords([tool('b','2'),tool('c')]);
  assert.equal((await env.sync()).saved, true);
  assert.deepEqual((await env.read()).tools.map(t=>t.id), ['b','c']);
  assert.deepEqual(await env.photos(), [origin+'/uploads/b.png?v=2',origin+'/uploads/c.png?v=1']);
  env.setRecords([]);
  await env.sync();
  assert.deepEqual((await env.read()).tools, []);
  assert.deepEqual(await env.photos(), []);
  assert.ok(env.requests.every(r=>r.options.cache === 'no-store'));
});

for (const failure of ['network','server','html','invalid','photo','photo-html']) {
  test(`${failure} response preserves the last complete catalogue`, async () => {
    const env=setup(); await env.sync();
    env.setRecords([tool('new')]); env.setFailure(failure);
    try { assert.equal((await env.sync()).saved, false); } catch (_) {}
    assert.deepEqual((await env.read()).tools.map(t=>t.id), ['a','b']);
    assert.equal((await env.photos()).length, 2);
  });
}

test('storage quota preserves records and returns online data without claiming saved', async () => {
  const env=setup(); await env.sync(); env.setQuota(true); env.setRecords([tool('new')]);
  const result=await env.sync();
  assert.equal(result.saved,false);
  assert.equal(result.data.tools[0].id,'new');
  assert.equal((await env.read()).tools[0].id,'a');
});

test('malformed and foreign photo URLs cannot replace the catalogue', async () => {
  const env=setup(); await env.sync();
  env.setRecords([{id:'x',name:'x',image_url:'https://other.test/photo.jpg'}]);
  await assert.rejects(env.sync());
  assert.equal((await env.read()).tools.length,2);
});

test('activation only removes old Toolbox shells', async () => {
  const env=setup();
  for(const name of ['toolbox-shell-v1','toolbox-shell-v2','unrelated-app','toolbox-photos-v1']) await env.caches.open(name);
  let completed;
  env.handlers.activate({waitUntil:promise=>completed=promise});
  await completed;
  assert.deepEqual(await env.caches.keys(), ['toolbox-shell-v2','unrelated-app','toolbox-photos-v1']);
});

test('offline navigation uses shell, photos are exact-version cached, writes/API bypass worker cache', async () => {
  const env=setup(); await env.sync(); env.setFailure('network');
  const shell=await env.caches.open('toolbox-shell-v2');
  await shell.put('/catalogue-shell',new Response('catalogue'));
  await shell.put('/offline',new Response('offline'));
  const request=async(path,method='GET',mode='cors')=>{
    let response;
    env.handlers.fetch({request:{url:origin+path,method,mode},respondWith:promise=>response=promise});
    return response;
  };
  assert.equal(await (await request('/?q=a','GET','navigate')).text(),'catalogue');
  assert.equal(await (await request('/tools/a/edit','GET','navigate')).text(),'offline');
  assert.equal(await (await request('/uploads/a.png?v=1')).text(),'image-bytes');
  assert.equal(await request('/api/tools'),undefined);
  assert.equal(await request('/tools/a/delete','POST'),undefined);
  await assert.rejects(request('/uploads/a.png?v=2'));
});
