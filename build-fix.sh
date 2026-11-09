#!/bin/sh
set -eu
sed -i "s/return adminAction(/return await adminAction(/" api/candriva.js
sed -i "s/if(action==='health')return send/if(action==='health'){await primary();return send/" api/candriva.js
sed -i "/if(action==='health')/s/});/});}/" api/candriva.js
sed -i "s/separate:true,payments:/separate:true,storage:'connected',payments:/" api/candriva.js
