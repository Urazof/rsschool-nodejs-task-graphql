import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { createGqlResponseSchema, gqlResponseSchema } from './schemas.js';
import { parse, execute, validate } from 'graphql';
import depthLimit from 'graphql-depth-limit';
import { schema } from './schema.js';
import { createLoaders } from './loaders.js';

const plugin: FastifyPluginAsyncTypebox = async (fastify) => {
  const { prisma } = fastify;

  fastify.route({
    url: '/',
    method: 'POST',
    schema: {
      ...createGqlResponseSchema,
      response: {
        200: gqlResponseSchema,
      },
    },
    async handler(req) {
      const loaders = createLoaders(prisma);

      try {
        const documentAST = parse(req.body.query);
        const validationErrors = validate(schema, documentAST, [depthLimit(5)]);

        if (validationErrors.length > 0) {
          return { errors: validationErrors };
        }

        const result = await execute({
          schema,
          document: documentAST,
          variableValues: req.body.variables,
          contextValue: {
            prisma,
            loaders,
          },
        });

        return result;
      } catch (error) {
        return { errors: [error] };
      }
    },
  });
};

export default plugin;
