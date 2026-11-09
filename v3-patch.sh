#!/bin/sh
set -eu
sed -i "s/paymentsEnabled:falseByDefault===true/paymentsEnabled:false/g" api/member.js
