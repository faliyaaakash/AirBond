"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const platform_socket_io_1 = require("@nestjs/platform-socket.io");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableCors({
        origin: '*',
    });
    app.useWebSocketAdapter(new platform_socket_io_1.IoAdapter(app));
    await app.listen(4000, '0.0.0.0');
    console.log('HTTP & Signaling Server running on http://localhost:4000');
}
bootstrap();
//# sourceMappingURL=main.js.map