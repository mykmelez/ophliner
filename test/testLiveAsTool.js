var assert = require('assert');
var expect = require('chai').expect;
var path = require('path');
var fse = require('fs-extra');
var childProcess = require('child_process');
var readYaml = require('read-yaml');
var temp = require('temp').track();

var GitHub = require('github');
var github = new GitHub({
  version: '3.0.0',
  protocol: 'https',
  headers: {
    'user-agent': 'Oghliner',
  },
});

var username = process.env.USER, password = process.env.PASS;

// Skip these tests if the USER or PASS environment variables aren't set.
if (!username || !password) {
  return;
}

function createRepo() {
  return new Promise(function(resolve, reject) {
    github.repos.create({
      name: 'test_oghliner_live',
      auto_init: true,
    }, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function deleteRepo() {
  return new Promise(function(resolve, reject) {
    github.repos.delete({
      user: username,
      repo: 'test_oghliner_live',
    }, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function getBranch() {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      github.repos.getBranch({
        user: username,
        repo: 'test_oghliner_live',
        branch: 'gh-pages',
      }, function(err, res) {
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      });
    }, 3000);
  });
}

function spawn(command, args, expected) {
  return new Promise(function(resolve, reject) {
    var child = childProcess.spawn(command, args);

    child.stdout.on('data', function(chunk) {
      process.stdout.write(chunk);
    });

    child.stderr.on('data', function(chunk) {
      process.stderr.write(chunk);
    });

    if (expected) {
      var output = '';
      var nextExpected = expected.shift();

      child.stdout.on('data', function(chunk) {
        output += chunk.toString();

        if (nextExpected && output.indexOf(nextExpected.q) != -1) {
          child.stdin.write(nextExpected.r + '\n');
          if (expected.length > 0) {
            nextExpected = expected.shift();
            output = '';
          } else {
            nextExpected = null;
          }
        }
      });
    }

    child.on('exit', function(code, signal) {
      if (code === 0) {
        resolve(code);
      } else {
        reject(code);
      }
    });

    child.on('error', function(err) {
      reject(err);
    });
  });
}

describe('CLI interface, oghliner as a tool', function() {
  this.timeout(120000);

  var oldWD = process.cwd();

  before(function() {
    github.authenticate({
      type: 'basic',
      username: username,
      password: password,
    });
  });

  beforeEach(function() {
    process.chdir(temp.mkdirSync('oghliner'));

    process.env.GH_TOKEN = username + ':' + password;

    return deleteRepo();
  });

  afterEach(function() {
    process.chdir(oldWD);

    delete process.env['GH_TOKEN'];
  });

  it('should work', function() {
    return createRepo()
    .then(() => spawn('git', ['clone', 'https://' + username + ':' + password + '@github.com/' + username + '/test_oghliner_live']))
    .then(() => process.chdir('test_oghliner_live'))
    .then(() => spawn(path.join(path.dirname(__dirname), 'cli.js'), ['offline', '.']))
    .then(() => spawn(path.join(path.dirname(__dirname), 'cli.js'), ['integrate', '.']))
    .then(() => spawn(path.join(path.dirname(__dirname), 'cli.js'), ['deploy', '.']))
    .then(getBranch)
    .catch(getBranch)
    .catch(getBranch)
    .then(() => spawn(path.join(path.dirname(__dirname), 'cli.js'), ['configure'], [
      {
        q: 'Username: ',
        r: username,
      },
      {
        q: 'Password: ',
        r: password,
      },
    ]))
    .then(function() {
      var travisYml = readYaml.sync('.travis.yml');
      expect(travisYml.language).to.equal('node_js');
      expect(travisYml.node_js).to.deep.equal(['0.12']);
      expect(travisYml.install).to.equal('npm install');
      expect(travisYml.script).to.equal('gulp');
      expect(travisYml).to.include.keys('env');
      expect(travisYml.env).to.include.keys('global');
      expect(travisYml.env.global).to.have.length(1);
      expect(travisYml.env.global[0]).to.have.keys('secure');
      expect(travisYml.after_success[0]).to.equal(
        'echo "travis_fold:end:after_success" && ' +
        '[ "${TRAVIS_PULL_REQUEST}" = "false" ] && [ "${TRAVIS_BRANCH}" = "master" ] && ' +
        'echo "Deploying…" && gulp deploy'
      );
    })
    .then(function() {
      fse.readdirSync('.').forEach(function(file) {
        if (file === '.git') {
          return;
        }

        fse.removeSync(file);
      });
    })
    .then(() => spawn('git', ['checkout', '-b', 'gh-pages']))
    .then(() => spawn('git', ['pull', 'origin', 'gh-pages']))
    .then(function() {
      assert.doesNotThrow(() => fse.statSync('offline-manager.js'));
      assert.doesNotThrow(() => fse.statSync('offline-worker.js'));
    });
  });
});
