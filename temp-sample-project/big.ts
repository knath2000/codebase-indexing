export function bigFunction(name: string) {
  // This is a multi-line function to test chunking
  let greeting = 'Hello, ' + name + '!';
  for (let i = 0; i < 10; i++) {
    greeting += ' Have a great day!';
  }
  return greeting;
}

export class Greeter {
  constructor(private name: string) {}
  greet() {
    let message = 'Hi, ' + this.name + '!';
    for (let i = 0; i < 5; i++) {
      message += ' Welcome!';
    }
    return message;
  }
}
