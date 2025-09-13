import { error as jsonError } from './response.js';

export default function errorHandler(error) {
  console.error(error);
  return jsonError(500, 'Server error');
}
