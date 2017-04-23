'use strict';

const Promise = require('bluebird');

const fs = Promise.promisifyAll(require('fs'));

const path = require('path');

const jsStringEscape = require('js-string-escape');

const difference = require('lodash.difference');

const debug_ = require('debug');

const debug = debug_('purs-loader');

const debugVerbose = debug_('purs-loader:verbose');

const PsModuleMap = require('./purs-module-map');

function updatePsModuleMap(psModule) {
  const options = psModule.options;

  const cache = psModule.cache;

  const filePurs = psModule.srcPath;

  if (!cache.psModuleMap) {
    debug('module mapping does not exist');

    return PsModuleMap.makeMap(options.src).then(map => {
      cache.psModuleMap = map;
      return cache.psModuleMap;
    });
  }
  else {
    return PsModuleMap.makeMapEntry(filePurs).then(result => {
      const map = Object.assign(cache.psModuleMap, result);

      cache.psModuleMap = map;

      return cache.psModuleMap;
    });
  }
}

 // Reference the bundle.
function makeBundleJS(psModule) {
  const bundleOutput = psModule.options.bundleOutput;

  const name = psModule.name;

  const srcDir = psModule.srcDir;

  const escaped = jsStringEscape(path.relative(srcDir, bundleOutput));

  const result = `module.exports = require("${escaped}")["${name}"]`;

  return result;
}

// Replace require paths to output files generated by psc with paths
// to purescript sources, which are then also run through this loader.
// Additionally, the imports replaced are tracked so that in the event
// the compiler fails to compile the PureScript source, we can tack on
// any new imports in order to allow webpack to watch the new files
// before they have been successfully compiled.
function makeJS(psModule, psModuleMap, js) {
  const requireRE = /require\(['"]\.\.\/([\w\.]+)['"]\)/g;

  const foreignRE = /require\(['"]\.\/foreign['"]\)/g;

  const name = psModule.name;

  const imports = psModuleMap[name].imports;

  var replacedImports = [];

  const result = js
    .replace(requireRE, (m, p1) => {
      const moduleValue = psModuleMap[p1];

      if (!moduleValue) {
        debug('module %s was not found in the map, replacing require with null', p1);

        return 'null';
      }
      else {
        const escapedPath = jsStringEscape(moduleValue.src);

        replacedImports.push(p1);

        return `require("${escapedPath}")`;
      }
    })
    .replace(foreignRE, () => {
      const escapedPath = jsStringEscape(psModuleMap[name].ffi);

      return `require("${escapedPath}")`;
    })
  ;

  const additionalImports = difference(imports, replacedImports);

  if (additionalImports.length) {
    debugVerbose('additional imports for %s: %o', name, additionalImports);
  }

  const additionalImportsResult = additionalImports.map(import_ => {
    const moduleValue = psModuleMap[import_];

    if (!moduleValue) {
      debug('module %s was not found in the map, skipping require', import_);

      return null;
    }
    else {
      const escapedPath = jsStringEscape(moduleValue.src);

      return `var ${import_.replace(/\./g, '_')} = require("${escapedPath}")`;
    }
  }).filter(a => a !== null).join('\n');

  const result_ = result + (additionalImports.length ? '\n' + additionalImportsResult : '');

  return result_;
}

module.exports = function toJavaScript(psModule) {
  const options = psModule.options;

  const cache = psModule.cache;

  const bundlePath = path.resolve(options.bundleOutput);

  const jsPath = options.bundle ? bundlePath : psModule.jsPath;

  const js = fs.readFileAsync(jsPath, 'utf8').catch(() => '');

  const psModuleMap = updatePsModuleMap(psModule);

  debugVerbose('loading JavaScript for %s', psModule.name);

  return Promise.props({js: js, psModuleMap: psModuleMap}).then(result =>
    options.bundle ?
      makeBundleJS(psModule) :
      makeJS(psModule, result.psModuleMap, result.js)
  );
};
