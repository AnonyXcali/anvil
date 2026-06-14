import { Injectable, Inject } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Kysely } from 'kysely';
import { KYSELY_DB } from 'src/db/db.constants';
import type { DB } from 'src/db/db.types';

/**
 * One gotcha: if you're behind Azure Container Apps or any reverse proxy/load balancer
 * (which I know you are at Axont), make sure idle timeouts and buffering are configured
 * to not kill long-lived SSE connections,
 * since some proxies buffer responses by default and break streaming.
 */
@Injectable()
export class CoreService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async handleFlowInitiation(query: string) {
    //create a conversation -> get conversation_id
    //access the kysely types and INSERT to DB -> jobs table, return conversation_id (only possible latency.)
    //create a job to intent processor and queue it
    //the job takes the query and the conversation_id futher.
    //return the conversation_id
  }

  handleRelay(conversationId: string) {
    //connect to the redis channel based on conversation id
    //recieve the list of buffered messages
    //recieve the live chunks
    //merge both, de-duplicate based on sequence number
    //relay to user the list

    return new Observable<{ data: string }>((observer) => {
      setInterval(() => {
        observer.next({
          data: 'Hello World',
        });
      });
    });
  }
}
