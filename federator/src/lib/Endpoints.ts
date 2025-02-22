import express from 'express';
import { Registry } from 'prom-client';

export class Endpoint {
  app: express.Express;
  router: express.Router;
  logger: any;
  port: number;
  register: Registry;

  constructor(_logger, port: number, register: Registry) {
    this.logger = _logger;
    this.port = port;
    if (this.logger.upsertContext) {
      this.logger.upsertContext('service', this.constructor.name);
    }

    this.register = register;
  }

  logCall(req, res, next) {
    console.log(req.originalUrl);
    next();
  }

  init() {
    this.app = express();
    this.router = express.Router();

    this.router.use(this.logCall);
    this.router.get('/isAlive', async (req, res) => {
      try {
        res.status(200).json({
          status: 'ok',
        });
      } catch (err) {
        this.logger.error('isAlive/ endpoint failed');
      }
    });

    this.router.get('/metrics', async (req, res) => {
      try {
        const metrics = await this.register.metrics();
        res.status(200).write(metrics);
        res.end();
      } catch (error) {
        this.logger.error('metrics endpoint failed');
      }
    });

    this.app.use('/', this.router);

    this.app.listen(this.port, () => {
      this.logger.info(`listening on http://localhost:${this.port}/`);
    });
  }
}
