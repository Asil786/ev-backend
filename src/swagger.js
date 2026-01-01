import swaggerJsdoc from 'swagger-jsdoc';

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'EVJoints Admin API',
            version: '1.1.0',
            description: 'API documentation for EVJoints Admin Dashboard backend'
        },
        servers: [
            {
                url: 'http://localhost:4000',
                description: 'Development server'
            },
            {
                url: 'https://devevjoints.netlify.app/.netlify/functions/api',
                description: 'Production server'
            }
        ],
        components: {
            schemas: {
                Customer: {
                    type: 'object',
                    properties: {
                        firstName: {
                            type: 'string',
                            example: 'John'
                        },
                        lastName: {
                            type: 'string',
                            example: 'Doe'
                        },
                        email: {
                            type: 'string',
                            format: 'email',
                            nullable: true,
                            example: 'john.doe@example.com'
                        },
                        phone: {
                            type: 'string',
                            example: '9876543210'
                        },
                        customerRegDate: {
                            type: 'string',
                            format: 'date-time',
                            example: '2024-01-15T10:30:00.000Z'
                        },
                        vehicleRegDate: {
                            type: 'string',
                            format: 'date-time',
                            nullable: true,
                            example: '2024-01-20T14:00:00.000Z'
                        },
                        registrationNumber: {
                            type: 'string',
                            nullable: true,
                            example: 'MH12AB1234'
                        },
                        subscription: {
                            type: 'string',
                            example: 'Premium'
                        },
                        vehicleType: {
                            type: 'string',
                            nullable: true,
                            example: 'Car'
                        },
                        manufacturer: {
                            type: 'string',
                            nullable: true,
                            example: 'Tata'
                        },
                        vehicleModel: {
                            type: 'string',
                            nullable: true,
                            example: 'Nexon EV'
                        },
                        vehicleVariant: {
                            type: 'string',
                            nullable: true,
                            example: 'Max'
                        },
                        deviceBrand: {
                            type: 'string',
                            nullable: true,
                            example: 'Samsung'
                        },
                        deviceModel: {
                            type: 'string',
                            nullable: true,
                            example: 'Galaxy S21'
                        },
                        devicePlatform: {
                            type: 'string',
                            nullable: true,
                            example: 'Android'
                        },
                        appVersion: {
                            type: 'string',
                            nullable: true,
                            example: '2.1.0'
                        },
                        navigation: {
                            type: 'string',
                            enum: ['Yes', 'No'],
                            example: 'Yes'
                        },
                        trip: {
                            type: 'string',
                            enum: ['Yes', 'No'],
                            example: 'Yes'
                        },
                        checkIn: {
                            type: 'string',
                            enum: ['Yes', 'No'],
                            example: 'Yes'
                        },
                        vehicles: {
                            type: 'array',
                            description: 'Array of all vehicles owned by this customer',
                            items: {
                                $ref: '#/components/schemas/Vehicle'
                            }
                        }
                    }
                },
                Vehicle: {
                    type: 'object',
                    properties: {
                        vehicleRegDate: {
                            type: 'string',
                            format: 'date-time',
                            example: '2024-01-20T14:00:00.000Z'
                        },
                        registrationNumber: {
                            type: 'string',
                            nullable: true,
                            example: 'MH12AB1234'
                        },
                        vehicleType: {
                            type: 'string',
                            nullable: true,
                            example: 'Car'
                        },
                        manufacturer: {
                            type: 'string',
                            nullable: true,
                            example: 'Tata'
                        },
                        vehicleModel: {
                            type: 'string',
                            nullable: true,
                            example: 'Nexon EV'
                        },
                        vehicleVariant: {
                            type: 'string',
                            nullable: true,
                            example: 'Max'
                        }
                    }
                },
                Pagination: {
                    type: 'object',
                    properties: {
                        total: {
                            type: 'integer',
                            example: 150,
                            description: 'Total number of records'
                        },
                        page: {
                            type: 'integer',
                            example: 1,
                            description: 'Current page number'
                        },
                        limit: {
                            type: 'integer',
                            example: 10,
                            description: 'Number of records per page'
                        }
                    }
                },
                CustomersResponse: {
                    type: 'object',
                    properties: {
                        data: {
                            type: 'array',
                            items: {
                                $ref: '#/components/schemas/Customer'
                            }
                        },
                        pagination: {
                            $ref: '#/components/schemas/Pagination'
                        }
                    }
                },
                Error: {
                    type: 'object',
                    properties: {
                        message: {
                            type: 'string',
                            example: 'Database connection error'
                        }
                    }
                }
            }
        }
    },
    apis: ['./src/routes/admin/*.js']
};

export const swaggerSpec = swaggerJsdoc(options);
