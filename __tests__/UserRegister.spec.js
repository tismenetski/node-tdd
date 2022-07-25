const request = require('supertest');
const app = require('../src/app');
const User = require('../src/user/User');
const sequelize = require('../src/config/database');
const SMTPserver = require('smtp-server').SMTPServer;

let lastMail, server;
let simulateSmtpFailure = false;

beforeAll(async () => {
  server = new SMTPserver({
    authOptional: true,
    onData(stream, session, callback) {
      let mailBody;
      stream.on('data', (data) => {
        mailBody += data.toString();
      });
      stream.on('end', () => {
        if (simulateSmtpFailure) {
          const err = new Error('invalid mailbox');
          err.responseCode = 553;
          return callback(err); // sending back error message to nodemailer client
        }
        lastMail = mailBody;
        callback();
      });
    },
  });

  await server.listen(8587, 'localhost');
  await sequelize.sync();
});

beforeEach(() => {
  simulateSmtpFailure = false;
  return User.destroy({ truncate: true });
});

afterAll(async () => {
  await server.close();
});

const validUser = {
  username: 'user1',
  email: 'user1@gmail.com',
  password: 'P4ssword',
};

const postUser = (user = validUser, options = {}) => {
  const agent = request(app).post('/api/1.0/users');
  if (options.language) {
    agent.set('Accept-Language', options.language);
  }
  return agent.send(user);
};

describe('User Registration', () => {
  it('returns 200 ok when signup request is valid', async () => {
    const response = await postUser();
    expect(response.status).toBe(200);
  });

  it('returns success message when signup request is valid', async () => {
    const response = await postUser();
    expect(response.body.message).toBe('User created');
  });

  it('saves the user to database', async () => {
    await postUser();

    // query user table
    const userList = await User.findAll();
    expect(userList.length).toBe(1);
  });

  it('saves the username and email to database', async () => {
    await postUser();
    // query user table
    const userList = await User.findAll();
    const savedUser = userList[0];
    expect(savedUser.username).toBe('user1');
    expect(savedUser.email).toBe('user1@gmail.com');
  });
  it('hashes the password in database', async () => {
    await postUser();
    // query user table
    const userList = await User.findAll();
    const savedUser = userList[0];
    expect(savedUser.password).not.toBe('P4ssword');
  });

  it('returns 400 when username is null', async () => {
    const response = await postUser({
      username: null,
      email: 'user1@gmail.com',
      password: 'P4ssword',
    });
    expect(response.status).toBe(400);
  });

  it('returns validation errors field in response body when validation error occurs', async () => {
    const response = await postUser({
      username: null,
      email: 'user1@gmail.com',
      password: 'P4ssword',
    });
    const body = response.body;
    expect(body.validationErrors).not.toBeUndefined();
  });

  it('returns errors for both when username and email is null', async () => {
    const response = await postUser({
      username: null,
      email: null,
      password: 'P4ssword',
    });
    const body = response.body;

    // Validation errors is an object which have { username : "..." , email : "..."}
    expect(Object.keys(body.validationErrors)).toEqual(['username', 'email']);
  });

  const username_null = 'Username cannot be null';
  const username_size = 'Must have min 4 and max 32 characters';
  const email_null = 'Email cannot be null';
  const email_invalid = 'Email is not valid';
  const password_null = 'Password cannot be null';
  const password_size = 'Password must be at least 6 characters';
  const password_pattern =
    'Password must have at least 1 uppercase, 1 lowercase and 1 number';
  const email_inuse = 'email in use';
  const email_failure = 'Email failure';
  const validation_failure = 'Validation Failure';
  it.each`
    field         | value               | expectedMessage
    ${'username'} | ${null}             | ${username_null}
    ${'username'} | ${'usr'}            | ${username_size}
    ${'username'} | ${'a'.repeat(33)}   | ${username_size}
    ${'email'}    | ${null}             | ${email_null}
    ${'email'}    | ${'mail.com'}       | ${email_invalid}
    ${'email'}    | ${'user.mail.com'}  | ${email_invalid}
    ${'email'}    | ${'user@mail'}      | ${email_invalid}
    ${'password'} | ${null}             | ${password_null}
    ${'password'} | ${'p4ssw'}          | ${password_size}
    ${'password'} | ${'alllowercase'}   | ${password_pattern}
    ${'password'} | ${'ALLUPPERCASE'}   | ${password_pattern}
    ${'password'} | ${'12323343453'}    | ${password_pattern}
    ${'password'} | ${'lowerANDUPPER'}  | ${password_pattern}
    ${'password'} | ${'lowerand123234'} | ${password_pattern}
    ${'password'} | ${'UPPER43535435'}  | ${password_pattern}
  `(
    'returns $expectedMessage when $field is $value',
    async ({ field, expectedMessage, value }) => {
      const user = {
        username: 'user1',
        email: 'a@a.com',
        password: 'P4ssword',
      };
      user[field] = value;
      const response = await postUser(user);
      const body = response.body;
      expect(body.validationErrors[field]).toBe(expectedMessage);
    }
  );

  it(`returns ${email_inuse} when same email is already in use`, async () => {
    await User.create({ ...validUser }); // having an user before sending it again with the same email
    const response = await postUser();
    expect(response.body.validationErrors.email).toBe(email_inuse);
  });

  it('returns error for both username is null and email is in use', async () => {
    await User.create({ ...validUser }); // having an user before sending it again with the same email
    const response = await postUser({
      username: null,
      email: validUser.email,
      password: 'P4ssword',
    });
    const body = response.body;
    expect(Object.keys(body.validationErrors)).toEqual(['username', 'email']);
  });

  it('creates user in inactive mode', async () => {
    await postUser();
    const users = await User.findAll();
    const savedUser = users[0];
    expect(savedUser.inactive).toBe(true);
  });

  it('creates user in inactive mode even the request body contains inactive as false', async () => {
    const newUser = { ...validUser, inactive: false };
    await postUser(newUser);
    const users = await User.findAll();
    const savedUser = users[0];
    expect(savedUser.inactive).toBe(true);
  });

  it('creates an activation token for user', async () => {
    await postUser();
    const users = await User.findAll();
    const savedUser = users[0];
    expect(savedUser.activationToken).toBeTruthy(); // falsy - null,undefined, '' , 0 ,false
  });

  it('sends an account activation with activation token', async () => {
    await postUser();

    // const lastMail = nodeMailerStub.interactsWithMail.lastMail();

    const users = await User.findAll();
    const savedUser = users[0];
    expect(lastMail).toContain('user1@gmail.com');
    expect(lastMail).toContain(savedUser.activationToken); // usually we avoid asserting more than one assertion in a test but this is an exception
  });
  it('returns 502 Bad Gateway when sending email fails', async () => {
    // const mockSendAccountActivation = jest
    //   .spyOn(EmailService, 'sendAccountActivation')
    //   .mockRejectedValue({ message: 'Failed to deliver email' }); // we "force" our function to return an error, which we handle in the catch block as a 502, resulting in passing the test

    simulateSmtpFailure = true;
    const response = await postUser();
    expect(response.status).toBe(502);
    // mockSendAccountActivation.mockRestore(); // once we finish mocking it's recommended to restore the function default behavior
  });
  it(`returns ${email_failure} message when sending mail fails`, async () => {
    // const mockSendAccountActivation = jest
    //   .spyOn(EmailService, 'sendAccountActivation')
    //   .mockRejectedValue({ message: 'Failed to deliver email' }); // we "force" our function to return an error, which we handle in the catch block as a 502, resulting in passing the test
    simulateSmtpFailure = true;
    const response = await postUser();
    // mockSendAccountActivation.mockRestore(); // once we finish mocking it's recommended to restore the function default behavior
    expect(response.body.message).toBe(email_failure);
  });
  it(`does not save user to database if activation mail fails`, async () => {
    // const mockSendAccountActivation = jest
    //   .spyOn(EmailService, 'sendAccountActivation')
    //   .mockRejectedValue({ message: 'Failed to deliver email' }); // we "force" our function to return an error, which we handle in the catch block as a 502, resulting in passing the test
    simulateSmtpFailure = true;
    await postUser();
    // mockSendAccountActivation.mockRestore(); // once we finish mocking it's recommended to restore the function default behavior
    const users = await User.findAll();
    expect(users.length).toBe(0);
  });

  it(`returns ${validation_failure} message in error response body when validation fails`, async () => {
    const response = await postUser({
      username: null,
      email: validUser.email,
      password: 'P4ssword',
    });
    expect(response.body.message).toBe(validation_failure);
  });
});

describe('Internationalization', () => {
  const username_null = 'שם המשתמש לא יכול להיות ריק';
  const username_size = 'חייב להיות בגודל של 4 תווים לפחות ו32 תווים לכל היותר';
  const email_null = 'מייל לא יכול להיות ריק';
  const email_invalid = 'מייל לא חוקי';
  const password_null = 'סיסמה לא יכולה להיות ריקה';
  const password_size = 'הסיסמה חייבת להיות באורך 6 תווים לפחות';
  const password_pattern =
    'הסיסמה חייבת להכיל אות קטנה, אות גדולה, ומספר אחד לפחות';
  const email_inuse = 'המייל כבר נמצא בשימוש';
  const user_create_success = 'המשתמש נוצר בהצלחה';
  const email_failure = 'שליחת המייל נכשלה';
  const validation_failure = 'ולידציה נכשלה';
  it.each`
    field         | value               | expectedMessage
    ${'username'} | ${null}             | ${username_null}
    ${'username'} | ${'usr'}            | ${username_size}
    ${'username'} | ${'a'.repeat(33)}   | ${username_size}
    ${'email'}    | ${null}             | ${email_null}
    ${'email'}    | ${'mail.com'}       | ${email_invalid}
    ${'email'}    | ${'user.mail.com'}  | ${email_invalid}
    ${'email'}    | ${'user@mail'}      | ${email_invalid}
    ${'password'} | ${null}             | ${password_null}
    ${'password'} | ${'p4ssw'}          | ${password_size}
    ${'password'} | ${'alllowercase'}   | ${password_pattern}
    ${'password'} | ${'ALLUPPERCASE'}   | ${password_pattern}
    ${'password'} | ${'12323343453'}    | ${password_pattern}
    ${'password'} | ${'lowerANDUPPER'}  | ${password_pattern}
    ${'password'} | ${'lowerand123234'} | ${password_pattern}
    ${'password'} | ${'UPPER43535435'}  | ${password_pattern}
  `(
    'returns $expectedMessage when $field is $value when language is set to hebrew',
    async ({ field, expectedMessage, value }) => {
      const user = {
        username: 'user1',
        email: 'a@a.com',
        password: 'P4ssword',
      };
      user[field] = value;
      const response = await postUser(user, { language: 'il' });
      const body = response.body;
      expect(body.validationErrors[field]).toBe(expectedMessage);
    }
  );

  it(`returns ${email_inuse} when same email is already in use when language is set to hebrew`, async () => {
    await User.create({ ...validUser }); // having an user before sending it again with the same email
    const response = await postUser({ ...validUser }, { language: 'il' });
    expect(response.body.validationErrors.email).toBe(email_inuse);
  });

  it(`returns success message of ${user_create_success} when language is set to hebrew`, async () => {
    const response = await postUser({ ...validUser }, { language: 'il' });
    expect(response.body.message).toBe(user_create_success);
  });

  it(`returns ${email_failure} message when sending mail fails and language is set to hebrew`, async () => {
    // const mockSendAccountActivation = jest
    //   .spyOn(EmailService, 'sendAccountActivation')
    //   .mockRejectedValue({ message: 'Failed to deliver email' }); // we "force" our function to return an error, which we handle in the catch block as a 502, resulting in passing the test
    simulateSmtpFailure = true;
    const response = await postUser({ ...validUser }, { language: 'il' });
    // mockSendAccountActivation.mockRestore(); // once we finish mocking it's recommended to restore the function default behavior
    expect(response.body.message).toBe(email_failure);
  });

  it(`returns ${validation_failure} message in error response body when validation fails and language is set to hebrew`, async () => {
    const response = await postUser(
      {
        username: null,
        email: validUser.email,
        password: 'P4ssword',
      },
      { language: 'il' }
    );
    expect(response.body.message).toBe(validation_failure);
  });
});

describe('Account activation', () => {
  it('activates the account when correct token is sent', async () => {
    await postUser();
    let users = await User.findAll();
    const token = users[0].activationToken;

    await request(app)
      .post('/api/1.0/users/token/' + token)
      .send();
    users = await User.findAll();
    expect(users[0].inactive).toBe(false);
  });
  it('removes the activationToken from user table after successful activation', async () => {
    await postUser();
    let users = await User.findAll();
    const token = users[0].activationToken;

    await request(app)
      .post('/api/1.0/users/token/' + token)
      .send();
    users = await User.findAll();
    expect(users[0].activationToken).toBeFalsy();
  });

  it('does not activate the account when token is wrong', async () => {
    await postUser();
    let users = await User.findAll();
    const token = 'invalidToken';

    await request(app)
      .post('/api/1.0/users/token/' + token)
      .send();
    users = await User.findAll();
    expect(users[0].inactive).toBe(true);
  });

  it('returns bad request when token is wrong', async () => {
    await postUser();
    const token = 'invalidToken';
    const response = await request(app)
      .post('/api/1.0/users/token/' + token)
      .send();
    expect(response.status).toBe(400);
  });

  it.each`
    language | tokenStatus  | message
    ${'il'}  | ${'wrong'}   | ${'החשבון הזה פעיל או שהטוקן אינו תקין'}
    ${'en'}  | ${'wrong'}   | ${'this account is either active or the token is invalid'}
    ${'il'}  | ${'correct'} | ${'החשבון הופעל בהצלחה'}
    ${'en'}  | ${'correct'} | ${'account is activated'}
  `(
    `returns $message when token is $tokenStatus and language is $language`,
    async ({ language, tokenStatus, message }) => {
      await postUser();
      let token = 'invalidToken';
      if (tokenStatus === 'correct') {
        let users = await User.findAll();
        token = users[0].activationToken;
      }
      const response = await request(app)
        .post('/api/1.0/users/token/' + token)
        .set('Accept-Language', language)
        .send();
      expect(response.body.message).toBe(message);
    }
  );
});

describe('Error Model', () => {
  it('returns path,timestamp, message and validationErrors in response when validation failure', async () => {
    const response = await postUser({ ...validUser, username: null });
    const body = response.body;
    expect(Object.keys(body)).toEqual([
      'path',
      'timestamp',
      'message',
      'validationErrors',
    ]);
  });
  it('returns path, timestamp and message in response when request fails other than validation error', async () => {
    await postUser();
    const token = 'invalidToken';
    const response = await request(app)
      .post('/api/1.0/users/token/' + token)
      .send();
    const body = response.body;
    expect(Object.keys(body)).toEqual(['path', 'timestamp', 'message']);
  });
  it('returns path in error body', async () => {
    await postUser();
    const token = 'invalidToken';
    const response = await request(app)
      .post('/api/1.0/users/token/' + token)
      .send();
    const body = response.body;
    expect(body.path).toEqual('/api/1.0/users/token/' + token);
  });
  it('returns timestamp in milliseconds within 5 seconds value in error body', async () => {
    const nowInMillis = new Date().getTime();
    const fiveSecondsLater = nowInMillis + 5 *1000;
    await postUser();
    const token = 'invalidToken';
    const response = await request(app)
        .post('/api/1.0/users/token/' + token)
        .send();
    const body = response.body;
    expect(body.timestamp).toBeGreaterThan(nowInMillis);
    expect(body.timestamp).toBeLessThan(fiveSecondsLater);
  });
});
