export class ForgeVTTPWA extends FormApplication {
  async render() {
    const event = this.constructor.installEvent;
    if (!event) {
      return;
    }
    event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") {
      ui.notifications.info(`Your Forge game has been installed!`);
    }
  }
}
