var AWS = require('aws-sdk');
var path = require('path');
var fs = require('fs');

var config = JSON.parse(fs.readFileSync('./config.json'));

AWS.config.update(config.aws);
var AUTODOCS_BUCKET = config.autodocs.bucket;
var AUTODOCS_PATH = config.autodocs.path;
var PROJECTS = config.projects;
var UNSTABLE_ORDER = config.unstableOrder;

var s3 = new AWS.S3();

var prefixRedirs = {};

var matchers = [
  function(val) {
    var matches = val.match(/^([^\d]*)-([\d]*)(\.([\d]*)(\.([\d]*))?)?(.*)?$/);
    if (matches) {
      if (!matches[4]) {
        matches[4] = 0;
      }
      if (!matches[6]) {
        matches[6] = 0;
      }
      if (matches[7]) {
        if (matches[7][0] === '-') {
          matches[7] = matches[7].substr(1);
        }

        var snapshotIdx = matches[7].indexOf('SNAPSHOT');
        if (snapshotIdx !== -1) {
          matches[7] = matches[7].substr(0, snapshotIdx);

          // Do not index SNAPSHOT versions
          return false;
        }
      }

      var name = matches[1];
      for (var i in PROJECTS) {
        if (PROJECTS.hasOwnProperty(i)) {
          var project = PROJECTS[i];
          if (name === i) {
            break;
          }
          if (project.aliases &&
              project.aliases.indexOf(name) !== -1) {
            name = i;
            break;
          }
        }
      }
      return {
        name: name,
        version: [
          parseInt(matches[2]),
          parseInt(matches[4]),
          parseInt(matches[6])
        ],
        unstable: matches[7],
        snapshot: snapshotIdx !== -1
      }
    }
  }
];

function minLen(num, len) {
  num = '' + num;
  while (num.length < len) {
    num = '0' + num;
  }
  return num;
}
function makeVersionCode(entry) {
  var baseVer =       minLen(entry.version[0], 4) +
                '.' + minLen(entry.version[1], 4) +
                '.' + minLen(entry.version[2], 4);

  if (!entry.unstable) {
    return baseVer;
  } else {
    var unstableIdx = UNSTABLE_ORDER.indexOf(entry.unstable);
    if (unstableIdx === -1) {
      unstableIdx = 9999;
    }
    return baseVer + '.' + minLen(unstableIdx, 4);
  }
}

var params = {
  Bucket: AUTODOCS_BUCKET,
  Delimiter: '/',
  Prefix: AUTODOCS_PATH,
  MaxKeys: 1000
};
s3.listObjects(params, function(err, data) {

  console.log(data);

  var sdks = [];

  var indexList = [];

  var folders = data.CommonPrefixes;
  for (var i = 0; i < folders.length; ++i) {
    // Grab the full folder path
    var fileName = folders[i].Prefix;

    // Extract just the specific sdk folder
    var sdkKey = fileName.substring(AUTODOCS_PATH.length, fileName.length - 1);

    if (sdkKey[0] === '.') {
      // Skip things starting with a dot.
      continue;
    }

    // Try to parse which client, as well as the version information
    for (var j = 0; j < matchers.length; ++j) {
      var match = matchers[j](sdkKey);
      if (match) {
        console.log(sdkKey, match);
        match.key = fileName;
        sdks.push(match);
        indexList.push(fileName);
        break;
      }
    }
  }

  var latests = {};
  var latestStables = {};
  for (var i = 0; i < sdks.length; ++i) {
    var sdk = sdks[i];
    var sdkVer = makeVersionCode(sdk);

    var latest = latests[sdk.name];
    if (!latest) {
      latests[sdk.name] = sdk;
    } else {
      var latestVer = makeVersionCode(latest);
      if (sdkVer > latestVer) {
        latests[sdk.name] = sdk;
      }
    }

    if (!sdk.unstable) {
      var latestStable = latestStables[sdk.name];
      if (!latestStable) {
        latestStables[sdk.name] = sdk;
      } else {
        var latestVer = makeVersionCode(latestStable);
        if (sdkVer > latestVer) {
          latestStables[sdk.name] = sdk;
        }
      }
    }
  }

  for(var i in PROJECTS) {
    if (PROJECTS.hasOwnProperty(i)) {
      var project = PROJECTS[i];

      if (!project.latestKey) {
        continue;
      }

      var latestStable = latestStables[i];
      if (latestStable) {
        prefixRedirs[project.latestKey] = {
          target: latestStable.key,
          code: 302
        };
      }
    }
  }

  console.log(latests);
  console.log(latestStables);
  console.log(indexList);
  console.log(prefixRedirs);
});