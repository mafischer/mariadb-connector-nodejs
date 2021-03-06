'use strict';

const base = require('../base.js');
const { assert } = require('chai');
const Conf = require('../conf');

describe('authentication plugin', () => {
  it('ed25519 authentication plugin', function(done) {
    if (process.env.MAXSCALE_VERSION) this.skip();
    const self = this;
    if (!shareConn.info.isMariaDB() || !shareConn.info.hasMinVersion(10, 1, 22))
      this.skip();
    shareConn
      .query("INSTALL SONAME 'auth_ed25519'")
      .then(
        () => {
          shareConn
            .query("drop user IF EXISTS verificationEd25519AuthPlugin@'%'")
            .then(() => {
              return shareConn.query(
                "CREATE USER verificationEd25519AuthPlugin@'%' IDENTIFIED " +
                  "VIA ed25519 USING 'ZIgUREUg5PVgQ6LskhXmO+eZLS0nC8be6HPjYWR4YJY'"
              );
            })
            .then(() => {
              return shareConn.query(
                "GRANT ALL on *.* to verificationEd25519AuthPlugin@'%'"
              );
            })
            .then(() => {
              base
                .createConnection({
                  user: 'verificationEd25519AuthPlugin',
                  password: 'secret'
                })
                .then(() => {
                  done(new Error('must have throw an error'));
                })
                .catch(err => {
                  const expectedMsg = err.message.includes(
                    "Client does not support authentication protocol 'client_ed25519' requested by server."
                  );
                  if (!expectedMsg) console.log(err);
                  shareConn.query('UNINSTALL PLUGIN ed25519');
                  assert(expectedMsg);
                  done();
                });
            })
            .catch(err => {
              const expectedMsg = err.message.includes(
                "Client does not support authentication protocol 'client_ed25519' requested by server."
              );
              if (!expectedMsg) console.log(err);
              assert(expectedMsg);
              done();
            });
        },
        err => {
          //server wasn't build with this plugin, cancelling test
          self.skip();
        }
      )
      .catch(done);
  });

  it('name pipe authentication plugin', function(done) {
    if (process.platform !== 'win32') this.skip();
    if (!shareConn.info.isMariaDB() || !shareConn.info.hasMinVersion(10, 1, 11))
      this.skip();
    if (
      Conf.baseConfig.host !== 'localhost' &&
      Conf.baseConfig.host !== 'mariadb.example.com'
    )
      this.skip();
    const windowsUser = process.env.USERNAME;
    if (windowsUser === 'root') this.skip();

    const self = this;
    shareConn
      .query('SELECT @@named_pipe as pipe')
      .then(res => {
        if (res[0].pipe) {
          shareConn
            .query("INSTALL PLUGIN named_pipe SONAME 'auth_named_pipe'")
            .then(() => {})
            .catch(err => {});
          shareConn
            .query('DROP USER ' + windowsUser)
            .then(() => {})
            .catch(err => {});
          shareConn
            .query(
              'CREATE USER ' +
                windowsUser +
                " IDENTIFIED VIA named_pipe using 'test'"
            )
            .then(() => {
              return shareConn.query('GRANT ALL on *.* to ' + windowsUser);
            })
            .then(() => {
              return shareConn.query(
                'select @@version_compile_os,@@socket soc'
              );
            })
            .then(res => {
              return base.createConnection({
                user: null,
                socketPath: '\\\\.\\pipe\\' + res[0].soc
              });
            })
            .then(conn => {
              return conn.end();
            })
            .then(done)
            .catch(done);
        } else {
          console.log('named pipe not enabled');
          self.skip();
        }
      })
      .catch(err => {});
  });

  it('unix socket authentication plugin', function(done) {
    if (process.platform === 'win32') this.skip();
    if (!shareConn.info.isMariaDB() || !shareConn.info.hasMinVersion(10, 1, 11))
      this.skip();
    if (process.env.MUST_USE_TCPIP) this.skip();
    if (
      Conf.baseConfig.host !== 'localhost' &&
      Conf.baseConfig.host !== 'mariadb.example.com'
    )
      this.skip();

    shareConn
      .query('select @@version_compile_os,@@socket soc')
      .then(res => {
        const unixUser = process.env.USERNAME;
        if (unixUser === 'root') this.skip();

        shareConn
          .query("INSTALL PLUGIN unix_socket SONAME 'auth_socket'")
          .catch(err => {});
        shareConn.query('DROP USER IF EXISTS ' + unixUser);
        shareConn.query(
          'CREATE USER ' + unixUser + " IDENTIFIED VIA unix_socket using 'test'"
        );
        shareConn
          .query('GRANT ALL on *.* to ' + unixUser)
          .then(() => {
            base
              .createConnection({ user: null, socketPath: res[0].soc })
              .then(conn => {
                return conn.end();
              })
              .then(() => {
                done();
              })
              .catch(done);
          })
          .catch(done);
      })
      .catch(done);
  });

  it('dialog authentication plugin', function(done) {
    //pam is set using .travis/entrypoint/pam.sh
    if (!process.env.TRAVIS || process.env.MAXSCALE_VERSION) this.skip();

    if (!shareConn.info.isMariaDB()) this.skip();
    this.timeout(10000);
    shareConn.query("INSTALL PLUGIN pam SONAME 'auth_pam'").catch(err => {});
    shareConn.query("DROP USER IF EXISTS 'testPam'@'%'").catch(err => {});
    shareConn.query(
      "CREATE USER 'testPam'@'%' IDENTIFIED VIA pam USING 'mariadb'"
    );
    shareConn.query("GRANT ALL ON *.* TO 'testPam'@'%' IDENTIFIED VIA pam");
    shareConn.query('FLUSH PRIVILEGES');

    //password is unix password "myPwd"
    base
      .createConnection({ user: 'testPam', password: 'myPwd' })
      .then(conn => {
        return conn.end();
      })
      .then(() => {
        done();
      })
      .catch(err => {
        if (err.errno === 1045 || err.errno === 1044) {
          done();
        } else {
          done(err);
        }
      });
  });
});
