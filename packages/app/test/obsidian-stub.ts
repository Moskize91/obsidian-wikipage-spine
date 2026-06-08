export class Notice {
  constructor(readonly message: string) {}
}

export class Plugin {
  addCommand(_command: { id: string; name: string; callback: () => void }): void {}
}
