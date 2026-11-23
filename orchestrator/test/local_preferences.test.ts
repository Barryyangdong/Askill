import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {preference,savePreference,preferenceBackup,restorePreferences} from "../src/local_preferences.ts";
test("settings reject concurrent overwrite and validate restore before writing",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"askill-prefs-"));
  try {
    savePreference(root,"workbench",{symbol:"600825"},0);
    assert.throws(()=>savePreference(root,"workbench",{symbol:"600519"},0));
    const backup=preferenceBackup(root);
    savePreference(root,"workbench",{symbol:"600519"},1);
    restorePreferences(root,backup);
    assert.deepEqual(preference(root,"workbench").value,{symbol:"600825"});
    assert.throws(()=>restorePreferences(root,{version:1,preferences:{workbench:{revision:1,value:"bad"},"../outside":{revision:0,value:{}}}}));
    assert.deepEqual(preference(root,"workbench").value,{symbol:"600825"});
    assert.ok(fs.existsSync(path.join(root,"preferences","before-restore.json")));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
